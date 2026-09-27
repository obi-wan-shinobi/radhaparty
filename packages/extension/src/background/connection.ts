import type { ClientMessage, ServerMessage } from "@radhaparty/shared";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:8787";

// Chrome stops a service worker after 30s without events. WebSocket traffic
// counts as activity (Chrome 116+), so ping more often than that.
const KEEPALIVE_MS = 20_000;
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 10_000;

// One WebSocket to the server for one tab. Reconnects with backoff until
// close() is called.
export class ServerConnection {
  private readonly label: string;
  private readonly onMessage: (msg: ServerMessage) => void;
  private ws: WebSocket | null = null;
  // Only the latest unsent message is kept: after an outage, an old play or
  // pause is stale, and only the most recent intent matters.
  private pending: ClientMessage | null = null;
  private keepalive: ReturnType<typeof setInterval> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private retryMs = MIN_RETRY_MS;
  private closed = false;

  constructor(label: string, onMessage: (msg: ServerMessage) => void) {
    this.label = label;
    this.onMessage = onMessage;
    this.open();
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.pending = msg;
    }
  }

  close(): void {
    this.closed = true;
    clearInterval(this.keepalive);
    clearTimeout(this.retry);
    this.ws?.close();
  }

  private open(): void {
    if (this.closed) return;
    const ws = new WebSocket(SERVER_URL);
    this.ws = ws;

    ws.onopen = () => {
      console.log(`[background] ${this.label} server connected: ${SERVER_URL}`);
      this.retryMs = MIN_RETRY_MS;
      if (this.pending) {
        ws.send(JSON.stringify(this.pending));
        this.pending = null;
      }
      this.keepalive = setInterval(() => {
        ws.send(JSON.stringify({ type: "ping", t0: Date.now() } satisfies ClientMessage));
      }, KEEPALIVE_MS);
    };

    ws.onmessage = (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        console.warn(`[background] ${this.label} bad message from server:`, e.data);
        return;
      }
      this.onMessage(msg);
    };

    ws.onclose = () => {
      clearInterval(this.keepalive);
      if (this.closed) return;
      console.log(`[background] ${this.label} server disconnected, retrying in ${this.retryMs}ms`);
      this.retry = setTimeout(() => this.open(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    };
  }
}
