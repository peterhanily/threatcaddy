type MessageHandler = (msg: Record<string, unknown>) => void;

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

  constructor(serverUrl: string, accessToken: string) {
    this.serverUrl = serverUrl;
    this.accessToken = accessToken;
  }

  onStatusChange(cb: (ok: boolean) => void) {
    this.statusCallback = cb;
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
        if (type === 'auth-ok' && this.statusCallback) {
          this.statusCallback(true);
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
      if (!this.intentionallyClosed) {
        if (this.statusCallback) this.statusCallback(false);
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  subscribe(folderId: string) {
    this.send({ type: 'subscribe', folderId });
  }

  unsubscribe(folderId: string) {
    this.send({ type: 'unsubscribe', folderId });
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
