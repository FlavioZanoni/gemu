import type { Envelope } from "./protocol";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws";

type Listener = (message: Envelope) => void;

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

export class WSClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private openListeners = new Set<() => void>();
  private closeListeners = new Set<() => void>();
  private queue: Envelope[] = [];
  private shouldReconnect = false;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;

  connect() {
    if (this.socket) return;
    this.shouldReconnect = true;
    this.openSocket();
  }

  private openSocket() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = new WebSocket(WS_URL);
    this.socket = socket;
    socket.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      this.openListeners.forEach((handler) => handler());
      const pending = this.queue;
      this.queue = [];
      pending.forEach((msg) => this.send(msg));
    });
    socket.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data) as Envelope;
        this.listeners.forEach((handler) => handler(data));
      } catch (err) {
        console.error("Failed to parse WS payload", err);
      }
    });
    socket.addEventListener("close", () => {
      this.socket = null;
      this.closeListeners.forEach((handler) => handler());
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });
    socket.addEventListener("error", () => {
      // Errors trigger close; reconnect logic lives there.
    });
  }

  private scheduleReconnect() {
    if (typeof window === "undefined") return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      if (!this.shouldReconnect) return;
      this.openSocket();
    }, delay);
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
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
