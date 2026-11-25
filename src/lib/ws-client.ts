type MessageHandler = (msg: Record<string, unknown>) => void;

// The server drops messages beyond 30 a second per connection.
const SUBSCRIPTIONS_PER_BURST = 20;
const SUBSCRIPTION_BURST_GAP_MS = 1100;
// The server forgets a person 30 seconds after their last presence update.
const PRESENCE_INTERVAL_MS = 15_000;

export class WSClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private serverUrl: string;
  private accessToken: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private intentionallyClosed = false;
  private statusCallback: ((ok: boolean) => void) | null = null;
  private statusFalseTimer: ReturnType<typeof setTimeout> | null = null;
  /** Investigations to hear changes for, and the ones this connection has asked for. */
  private wanted = new Set<string>();
  private subscribed = new Set<string>();
  private authenticated = false;
  private subscriptionTimer: ReturnType<typeof setTimeout> | null = null;
  /** This connection's id on the server (from `auth-ok`; older servers send none). */
  private connection: string | null = null;
  /** The investigation and view this person has open, told to the investigation's other members. */
  private presence: { folderId: string; view: string } | null = null;
  /** Investigations whose subscription the server has confirmed: it answers one with their presence. */
  private presenceReady = new Set<string>();
  private presenceTimer: ReturnType<typeof setInterval> | null = null;

  constructor(serverUrl: string, accessToken: string) {
    this.serverUrl = serverUrl;
    this.accessToken = accessToken;
  }

  onStatusChange(cb: (ok: boolean) => void) {
    this.statusCallback = cb;
  }

  // Debounce the "false" status to avoid flickering during reconnects
  private fireStatusChange(ok: boolean) {
    if (!this.statusCallback) return;
    if (ok) {
      // Connected — cancel any pending "disconnected" callback and fire immediately
      if (this.statusFalseTimer) {
        clearTimeout(this.statusFalseTimer);
        this.statusFalseTimer = null;
      }
      this.statusCallback(true);
    } else {
      // Disconnected — wait before notifying, in case we reconnect quickly
      if (this.statusFalseTimer) return; // already scheduled
      this.statusFalseTimer = setTimeout(() => {
        this.statusFalseTimer = null;
        if (this.statusCallback) this.statusCallback(false);
      }, 5000);
    }
  }

  connect() {
    this.intentionallyClosed = false;
    const wsUrl = this.serverUrl.replace(/^http/, 'ws');
    this.ws = new WebSocket(`${wsUrl}/ws`);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      // Authenticate via first message instead of URL query param
      this.send({ type: 'auth', token: this.accessToken });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const type = msg.type as string;
        // Fire status callback on successful auth
        if (type === 'auth-ok') {
          this.fireStatusChange(true);
          // A new connection holds no subscriptions: ask for all of them again.
          this.authenticated = true;
          this.connection = typeof msg.connectionId === 'string' && /^[0-9a-f-]{36}$/.test(msg.connectionId) ? msg.connectionId : null;
          this.presenceReady.clear();
          this.subscribed.clear();
          this.sendSubscriptions();
        }
        // The server accepts a presence update only once the subscription holds, and says so with this message.
        if (type === 'presence' && typeof msg.folderId === 'string' && !this.presenceReady.has(msg.folderId)) {
          this.presenceReady.add(msg.folderId);
          if (this.presence?.folderId === msg.folderId) this.sendPresence();
        }
        const typeHandlers = this.handlers.get(type);
        if (typeHandlers) {
          for (const handler of typeHandlers) {
            handler(msg);
          }
        }
        // Also fire '*' wildcard handlers
        const allHandlers = this.handlers.get('*');
        if (allHandlers) {
          for (const handler of allHandlers) {
            handler(msg);
          }
        }
      } catch { /* ignore parse errors */ }
    };

    this.ws.onclose = () => {
      this.authenticated = false;
      this.connection = null;
      if (!this.intentionallyClosed) {
        this.fireStatusChange(false);
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    // Add jitter (±25%) to prevent thundering herd when many clients reconnect simultaneously
    const jitter = this.reconnectDelay * (0.75 + Math.random() * 0.5);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, jitter);
  }

  /**
   * The investigations to hear committed changes for. Replaces the previous list, and is sent again
   * after every reconnect. The server announces a change only to subscribers.
   */
  setSubscriptions(folderIds: Iterable<string>) {
    this.wanted = new Set(folderIds);
    this.sendSubscriptions();
  }

  /** Sends the difference between the wanted and the held subscriptions, under the server's 30 messages a second. */
  private sendSubscriptions() {
    if (this.subscriptionTimer || !this.authenticated || !this.isConnected) return;
    let budget = SUBSCRIPTIONS_PER_BURST;
    for (const folderId of this.subscribed) {
      if (this.wanted.has(folderId)) continue;
      if (!budget--) break;
      this.subscribed.delete(folderId);
      this.presenceReady.delete(folderId);
      this.send({ type: 'unsubscribe', folderId });
    }
    for (const folderId of this.wanted) {
      if (this.subscribed.has(folderId)) continue;
      if (budget-- <= 0) break;
      this.subscribed.add(folderId);
      this.send({ type: 'subscribe', folderId });
    }
    if (budget >= 0) return;
    this.subscriptionTimer = setTimeout(() => {
      this.subscriptionTimer = null;
      this.sendSubscriptions();
    }, SUBSCRIPTION_BURST_GAP_MS);
  }

  /** The id a push names so that the server tells this person's other devices, but not this one. */
  get connectionId(): string | null {
    return this.connection;
  }

  /**
   * The investigation this person has open and the view they are on, or null for none. Sent to the
   * investigation's other members once the server holds the subscription, and again every 15 seconds
   * while the page is visible; the server drops a person 30 seconds after the last one.
   */
  setPresence(folderId: string | null, view: string) {
    const changed = this.presence?.folderId !== (folderId ?? undefined) || this.presence?.view !== view;
    this.presence = folderId ? { folderId, view } : null;
    if (this.presence && !this.presenceTimer) {
      this.presenceTimer = setInterval(() => {
        if (typeof document === 'undefined' || !document.hidden) this.sendPresence();
      }, PRESENCE_INTERVAL_MS);
    } else if (!this.presence && this.presenceTimer) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
    if (changed) this.sendPresence();
  }

  private sendPresence() {
    if (!this.presence || !this.authenticated || !this.presenceReady.has(this.presence.folderId)) return;
    this.send({ type: 'presence-update', folderId: this.presence.folderId, view: this.presence.view });
  }

  on(type: string, handler: MessageHandler): () => void {
    let handlers = this.handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(type, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) this.handlers.delete(type);
    };
  }

  send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect() {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.statusFalseTimer) {
      clearTimeout(this.statusFalseTimer);
      this.statusFalseTimer = null;
    }
    if (this.subscriptionTimer) {
      clearTimeout(this.subscriptionTimer);
      this.subscriptionTimer = null;
    }
    if (this.presenceTimer) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
    this.authenticated = false;
    this.connection = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.handlers.clear();
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  updateToken(token: string) {
    this.accessToken = token;
    // Reconnect with new token
    if (this.ws) {
      this.ws.close();
      // onclose will trigger reconnect
    }
  }
}
