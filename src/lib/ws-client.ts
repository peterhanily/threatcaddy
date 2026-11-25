type MessageHandler = (msg: Record<string, unknown>) => void;

// The server drops messages beyond 30 a second per connection.
const SUBSCRIPTIONS_PER_BURST = 20;
const SUBSCRIPTION_BURST_GAP_MS = 1100;

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
          this.subscribed.clear();
          this.sendSubscriptions();
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

  updatePresence(folderId: string, view: string, entityId?: string) {
    this.send({ type: 'presence-update', folderId, view, entityId });
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
    this.authenticated = false;
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
