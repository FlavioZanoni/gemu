import type { Envelope } from "./protocol";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws";

type Listener = (message: Envelope) => void;

export class WSClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private openListeners = new Set<() => void>();
  private closeListeners = new Set<() => void>();
  private queue: Envelope[] = [];

  connect() {
    if (this.socket) return;
    this.socket = new WebSocket(WS_URL);
    this.socket.addEventListener("open", () => {
      this.openListeners.forEach((handler) => handler());
      this.queue.forEach((msg) => this.send(msg));
      this.queue = [];
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
    });
  }

  disconnect() {
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
