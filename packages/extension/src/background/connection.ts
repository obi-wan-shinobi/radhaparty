import type { ClientMessage, ServerMessage } from "@radhaparty/shared";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:8787";

// Chrome stops a service worker after 30s without events. WebSocket traffic
// counts as activity (Chrome 116+), so ping more often than that.
const KEEPALIVE_MS = 20_000;
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 10_000;

// Clock sync. Each pong carries the server's time. Assuming the network
// delay is the same both ways, the server read its clock half a round trip
// after we sent the ping, so offset = serverTime - (sentAt + roundTrip / 2).
// Pings that waited in a queue give skewed estimates and also have longer
// round trips, so the sample with the shortest round trip is trusted.
// A burst of pings on connect gives a good estimate quickly; the keepalive
// pings keep it fresh.
const INITIAL_PINGS = 5;
const INITIAL_PING_GAP_MS = 150;
const CLOCK_SAMPLES = 8;

type ClockSample = { roundTripMs: number; offsetMs: number };

export type ConnectionHandlers = {
  // Called on every (re)connect, before any queued message is sent. The
  // server forgets a client's room when its socket closes, so this is where
  // the room is joined again.
  onOpen: () => void;
  onMessage: (msg: ServerMessage) => void;
  // Called after each pong with the current best estimate of
  // serverClock - ourClock, and the round trip of the sample it came from.
  onClock: (offsetMs: number, roundTripMs: number) => void;
};

// One WebSocket to the server for one tab. Reconnects with backoff until
// close() is called.
export class ServerConnection {
  private readonly label: string;
  private readonly handlers: ConnectionHandlers;
  private ws: WebSocket | null = null;
  // Only the latest unsent message is kept: after an outage, an old play or
  // pause is stale, and only the most recent intent matters.
  private pending: ClientMessage | null = null;
  private keepalive: ReturnType<typeof setInterval> | undefined;
  private burst: ReturnType<typeof setInterval> | undefined;
  private samples: ClockSample[] = [];
  private retry: ReturnType<typeof setTimeout> | undefined;
  private retryMs = MIN_RETRY_MS;
  private closed = false;

  constructor(label: string, handlers: ConnectionHandlers) {
    this.label = label;
    this.handlers = handlers;
    this.open();
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.pending = msg;
    }
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.closed = true;
    clearInterval(this.keepalive);
    clearInterval(this.burst);
    clearTimeout(this.retry);
    this.ws?.close();
  }

  private open(): void {
    if (this.closed) return;
    const ws = new WebSocket(SERVER_URL);
    this.ws = ws;
    // A reconnect may reach a different server process, with its own clock.
    this.samples = [];

    ws.onopen = () => {
      console.log(`[background] ${this.label} server connected: ${SERVER_URL}`);
      this.retryMs = MIN_RETRY_MS;
      // Ping before joining, so the first pong arrives before the room's
      // state and the state can be placed on the server's clock.
      this.ping(ws);
      let burstLeft = INITIAL_PINGS - 1;
      this.burst = setInterval(() => {
        this.ping(ws);
        if (--burstLeft <= 0) clearInterval(this.burst);
      }, INITIAL_PING_GAP_MS);
      this.handlers.onOpen();
      if (this.pending) {
        ws.send(JSON.stringify(this.pending));
        this.pending = null;
      }
      this.keepalive = setInterval(() => this.ping(ws), KEEPALIVE_MS);
    };

    ws.onmessage = (e) => {
      // Messages can still arrive between close() and the socket closing,
      // for example from the old room after switching rooms.
      if (this.closed) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        console.warn(`[background] ${this.label} bad message from server:`, e.data);
        return;
      }
      if (msg.type === "pong") {
        this.recordPong(msg.t0, msg.ts);
        return;
      }
      this.handlers.onMessage(msg);
    };

    ws.onclose = () => {
      clearInterval(this.keepalive);
      clearInterval(this.burst);
      if (this.closed) return;
      console.log(`[background] ${this.label} server disconnected, retrying in ${this.retryMs}ms`);
      this.retry = setTimeout(() => this.open(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    };
  }

  private ping(ws: WebSocket): void {
    ws.send(JSON.stringify({ type: "ping", t0: Date.now() } satisfies ClientMessage));
  }

  private recordPong(sentAt: number, serverTime: number): void {
    const roundTripMs = Date.now() - sentAt;
    if (roundTripMs < 0) return; // our clock was adjusted mid-ping
    this.samples.push({ roundTripMs, offsetMs: serverTime - (sentAt + roundTripMs / 2) });
    if (this.samples.length > CLOCK_SAMPLES) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.roundTripMs < a.roundTripMs ? b : a));
    this.handlers.onClock(best.offsetMs, best.roundTripMs);
  }
}
