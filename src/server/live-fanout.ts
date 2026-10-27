import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import type { ListenerSocket } from "./live-transport";

/*
 * Live listeners' sockets stay on Core's main thread, where Hub accepted them: Node can't hand a socket to a
 * worker thread. The audio worker posts each packet once, with the listeners it goes to, and Core writes it
 * to each of them. Both directions cross the worker's one port, so each listener's messages and packets stay
 * in order.
 */
export type ListenerEvent =
  | { type: "listenerOpen"; id: number; sourceId: string; deviceId: string }
  | { type: "listenerMessage"; id: number; data: string; binary: boolean }
  | { type: "listenerClosed"; id: number };
export type ListenerCommand =
  | { type: "listenerAudio"; packet: Uint8Array; to: number[] }
  | { type: "listenerSend"; id: number; text: string }
  | { type: "listenerClose"; id: number; code: number; reason: string };

/** Core's side: each listener's socket and its backlog guard. */
export function createListenerFanout(post: (event: ListenerEvent) => void) {
  const listeners = new Map<number, { socket: WebSocket; stalledMs: () => number }>();
  let ids = 0;
  return {
    listen(socket: WebSocket, sourceId: string, deviceId: string) {
      const id = ++ids, pings: number[] = [], stalledMs = () => pings.length ? performance.now() - pings[0]! : 0;
      listeners.set(id, { socket, stalledMs });
      const gone = () => { if (listeners.delete(id)) { clearInterval(pinging); post({ type: "listenerClosed", id }); } };
      // A listener's audio never queues behind a stalled connection. Pings wait behind everything sent, kernel
      // buffers included: one unanswered for half a second stops its audio, for two seconds closes it so that
      // it reconnects (live-transport.ts).
      const pinging = setInterval(() => {
        if (stalledMs() > 2000) { socket.close(4002, "This connection fell behind the live audio."); gone(); }
        else if (socket.readyState === WebSocket.OPEN) { pings.push(performance.now()); socket.ping(); }
      }, 100);
      socket.on("pong", () => pings.shift());
      socket.on("error", () => socket.terminate());
      socket.on("message", (data, binary) => listeners.has(id) && post({ type: "listenerMessage", id, data: String(data), binary }));
      socket.once("close", gone);
      post({ type: "listenerOpen", id, sourceId, deviceId });
    },
    receive(command: ListenerCommand) {
      if (command.type === "listenerAudio") {
        const packet = Buffer.from(command.packet.buffer, command.packet.byteOffset, command.packet.byteLength);
        for (const id of command.to) {
          const l = listeners.get(id);
          if (!l || l.socket.readyState !== WebSocket.OPEN || l.stalledMs() > 500) continue;
          if (l.socket.bufferedAmount > 256 * 1024) l.socket.terminate();
          else l.socket.send(packet);
        }
      } else if (command.type === "listenerSend") {
        const socket = listeners.get(command.id)?.socket;
        if (socket?.readyState === WebSocket.OPEN) socket.send(command.text);
      } else listeners.get(command.id)?.socket.close(command.code, command.reason);
    },
    close() { for (const { socket } of listeners.values()) socket.terminate(); },
  };
}

// As live-transport sees a listener: closing it is final at once, as the old loopback socket's was.
class RemoteListener extends EventEmitter implements ListenerSocket {
  readyState = 1;
  constructor(readonly id: number, private readonly post: (command: ListenerCommand) => void) { super(); }
  send(text: string) { if (this.readyState === 1) this.post({ type: "listenerSend", id: this.id, text }); }
  close(code: number, reason: string) {
    if (this.readyState !== 1) return;
    this.post({ type: "listenerClose", id: this.id, code, reason });
    this.closed();
  }
  closed() { if (this.readyState === 1) { this.readyState = 3; queueMicrotask(() => this.emit("close")); } }
}

/** The audio worker's side: listeners whose sockets are on Core's main thread. */
export function createRemoteListeners(post: (command: ListenerCommand, transfer?: ArrayBuffer[]) => void, accept: (socket: ListenerSocket, sourceId: string, deviceId: string) => void) {
  const listeners = new Map<number, RemoteListener>();
  return {
    receive(event: ListenerEvent) {
      if (event.type === "listenerOpen") {
        const socket = new RemoteListener(event.id, post);
        listeners.set(event.id, socket); socket.once("close", () => listeners.delete(event.id));
        accept(socket, event.sourceId, event.deviceId);
      } else if (event.type === "listenerMessage") listeners.get(event.id)?.emit("message", event.data, event.binary);
      else listeners.get(event.id)?.closed();
    },
    // The packet's own copy moves to Core rather than being cloned.
    fanout(packet: Buffer, to: ListenerSocket[]) {
      const data = new Uint8Array(packet);
      post({ type: "listenerAudio", packet: data, to: to.map(socket => (socket as RemoteListener).id) }, [data.buffer]);
    },
  };
}
