import { EventEmitter } from "node:events";
import type { Writable } from "node:stream";
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

// Each write to a listener, with its TLS record, costs Core's main thread far more than the bytes in it. From
// this many listeners on, each one's audio leaves two packets per write: the first waits one packet longer
// (2.67 ms PCM, 2.5 ms Opus). A message to the listener takes its waiting packet along, never waits itself.
export const pairedFrom = 20;

type Listener = { socket: WebSocket; stream: Writable; stalledMs: () => number; waiting: Buffer[] };

/** Core's side: each listener's socket and its backlog guard. */
export function createListenerFanout(post: (event: ListenerEvent) => void) {
  const listeners = new Map<number, Listener>();
  let ids = 0, timeout: ReturnType<typeof setTimeout> | undefined;
  const write = (l: Listener, last?: string) => {
    l.stream.cork();
    for (const packet of l.waiting) l.socket.send(packet);
    if (last !== undefined) l.socket.send(last);
    l.stream.uncork();
    l.waiting = [];
  };
  const flush = () => { for (const l of listeners.values()) if (l.waiting.length) write(l); };
  return {
    /** stream: the socket the WebSocket upgraded, corked around each write. */
    listen(socket: WebSocket, stream: Writable, sourceId: string, deviceId: string) {
      const id = ++ids, pings: number[] = [], stalledMs = () => pings.length ? performance.now() - pings[0]! : 0;
      listeners.set(id, { socket, stream, stalledMs, waiting: [] });
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
        const packet = Buffer.from(command.packet.buffer, command.packet.byteOffset, command.packet.byteLength), per = command.to.length < pairedFrom ? 1 : 2;
        for (const id of command.to) {
          const l = listeners.get(id);
          if (!l || l.socket.readyState !== WebSocket.OPEN || l.stalledMs() > 500) continue;
          if (l.socket.bufferedAmount > 256 * 1024) { l.socket.terminate(); continue; }
          if (l.waiting.push(packet) >= per) write(l);
        }
        // Should the next packet not come, the waiting ones leave without it.
        (timeout ??= setTimeout(flush, 5)).refresh();
        return;
      }
      const l = listeners.get(command.id);
      if (command.type === "listenerSend") { if (l?.socket.readyState === WebSocket.OPEN) write(l, command.text); }
      else if (l) { write(l); l.socket.close(command.code, command.reason); }
    },
    close() { clearTimeout(timeout); for (const { socket } of listeners.values()) socket.terminate(); },
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
