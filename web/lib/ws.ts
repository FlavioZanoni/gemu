import type { Envelope } from "./protocol";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws";

type Listener = (message: Envelope) => void;

export const createRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// While the socket is down only control messages are queued for replay.
// Game actions and canvas strokes are moment-bound: replaying a stale guess or
// a half-minute-old stroke after a reconnect does more harm than dropping it.
// Joins and creates aren't queued either: the room store owns them (it keeps
// the one pending request and re-sends it itself from its open listener), so
// a queued copy would go out twice, or after the store already gave up on it.
const isUnqueued = (type: string) =>
  type === "game.action" || type === "game.stream" || type === "room.join" || type === "room.create";
const MAX_QUEUE = 50;

export class WSClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private openListeners = new Set<() => void>();
  private closeListeners = new Set<() => void>();
  private queue: Envelope[] = [];
  private shouldReconnect = true;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect() {
    if (this.socket) return;
    this.shouldReconnect = true;
    this.open();
  }

  /** True when the socket is open right now (listeners added late use this
   *  instead of waiting for an `open` event that already fired). */
  isOpen() {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  private open() {
    this.socket = new WebSocket(WS_URL);
    this.socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      // Listeners first: the room store's (re)join goes out before queued
      // control messages that only make sense once we're back in the room.
      this.openListeners.forEach((handler) => handler());
      const pending = this.queue;
      this.queue = [];
      pending.forEach((msg) => this.send(msg));
    });
    this.socket.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data) as Envelope;
        this.listeners.forEach((handler) => handler(data));
      } catch (err) {
        console.error("Failed to parse WS payload", err);
      }
    });
    this.socket.addEventListener("close", () => {
      this.socket = null;
      this.closeListeners.forEach((handler) => handler());
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect || this.reconnectTimer) return;
    // 0.5s, 1s, 2s, 4s, 8s, then every 10s — a game night survives flaky wifi.
    const delay = Math.min(500 * 2 ** this.reconnectAttempt, 10_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect && !this.socket) {
        this.open();
      }
    }, delay);
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (!this.socket) return;
    this.socket.close();
    this.socket = null;
  }

  onMessage(handler: Listener) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  onOpen(handler: () => void) {
    this.openListeners.add(handler);
    return () => this.openListeners.delete(handler);
  }

  onClose(handler: () => void) {
    this.closeListeners.add(handler);
    return () => this.closeListeners.delete(handler);
  }

  /**
   * Sends now when the socket is open and returns true. Otherwise returns
   * false: control messages are queued for the next open, while game
   * actions/strokes and joins/creates are dropped (see isUnqueued).
   */
  send(message: Envelope): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      if (isUnqueued(message.type)) return false;
      this.queue.push(message);
      if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
      return false;
    }
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }
}

let sharedClient: WSClient | null = null;

export const getWSClient = () => {
  if (!sharedClient) {
    sharedClient = new WSClient();
  }
  return sharedClient;
};
