import type { Envelope } from "./protocol";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws";

type Listener = (message: Envelope) => void;

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

  private open() {
    this.socket = new WebSocket(WS_URL);
    this.socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
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

  send(message: Envelope) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.queue.push(message);
      return;
    }
    this.socket.send(JSON.stringify(message));
  }
}

let sharedClient: WSClient | null = null;

export const getWSClient = () => {
  if (!sharedClient) {
    sharedClient = new WSClient();
  }
  return sharedClient;
};
