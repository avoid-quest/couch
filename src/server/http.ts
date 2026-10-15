import { createServer, STATUS_CODES, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { createServer as createNetServer, type AddressInfo, type Socket as NetSocket } from "node:net";
import type { TLSSocket } from "node:tls";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { WebSocketServer, type WebSocket } from "ws";
import { loopbackPeer } from "./lan-listener";

// node:http and ws behind the fetch-style handler Core's routes are written
// against: each request becomes a Request, each Response is streamed back.
export type Socket<T> = WebSocket & { data: T };
// A function takes the socket as it is instead of Couch's own handlers (Sendspin, #644 ticket 10).
export type Upgrade<T> = (data: T | ((socket: WebSocket, request: IncomingMessage) => void)) => boolean;
// Turning HTTP off closes plaintext connections; the one carrying `current` closes once its response is sent.
export type Listener = { port: number; setAllowHttp: (enabled: boolean, current?: Request) => void; stop: () => Promise<void> };
type Options<T> = {
  hostname: string;
  port: number;
  // Serves HTTPS and plain HTTP on one port. Plain HTTP is for this machine only (localhost is
  // a secure context); the LAN redirects to HTTPS unless compatibility mode is enabled.
  tls?: { key: string; cert: string; securePort?: number; allowHttp?: boolean };
  maxRequestBodySize: number;
  fetch: (request: Request, upgrade: Upgrade<T>) => Promise<Response | undefined>;
  websocket: {
    maxPayload: number;
    open: (socket: Socket<T>) => void;
    // Binary frames arrive as null.
    message: (socket: Socket<T>, message: string | null) => void;
    close: (socket: Socket<T>) => void;
  };
};

const peers = new WeakMap<Request, string>();
const responses = new WeakMap<Request, ServerResponse>();
export const requestPeer = (request: Request) => peers.get(request) ?? "";
/** Runs once the response to `request` is sent or abandoned, so a change can't cut off its own reply. */
export function afterResponse(request: Request, run: () => void) {
  const response = responses.get(request);
  if (response && !response.closed) response.once("close", run);
  else setImmediate(run);
}

const encrypted = (message: IncomingMessage) => !!(message.socket as TLSSocket).encrypted;
function toRequest(message: IncomingMessage, body?: Buffer, signal?: AbortSignal) {
  const headers = new Headers();
  for (const [name, values] of Object.entries(message.headersDistinct)) for (const value of values ?? []) headers.append(name, value);
  const request = new Request(new URL(message.url ?? "/", `${encrypted(message) ? "https" : "http"}://${message.headers.host ?? "localhost"}`), { method: message.method, headers, ...(body ? { body: body as Uint8Array<ArrayBuffer> } : {}), ...(signal ? { signal } : {}) });
  peers.set(request, message.socket.remoteAddress ?? "");
  return request;
}

async function readBody(message: IncomingMessage, limit: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of message as AsyncIterable<Buffer>) {
    if ((size += chunk.length) > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function serve<T>({ hostname, port, tls, maxRequestBodySize, fetch, websocket }: Options<T>): Promise<Listener> {
  let allowHttp = !!tls?.allowHttp;
  const plaintext = new Set<NetSocket>();
  const insecure = (message: IncomingMessage) => !!tls && !allowHttp && !encrypted(message) && !loopbackPeer(message.socket.remoteAddress ?? "");
  const handle = async (message: IncomingMessage, response: ServerResponse) => {
    try {
      if (insecure(message)) {
        const { hostname: host } = new URL(`http://${message.headers.host}`);
        response.writeHead(308, { Location: `https://${host}:${tls!.securePort ?? port}${message.url ?? "/"}`, "Cache-Control": "no-store" }).end();
        return;
      }
      const aborted = new AbortController();
      response.once("close", () => { if (!response.writableFinished) aborted.abort(); });
      const body = message.method === "GET" || message.method === "HEAD" ? undefined : await readBody(message, maxRequestBodySize);
      if (body === null) { response.writeHead(413, { Connection: "close" }).end(); return; }
      const request = toRequest(message, body, aborted.signal);
      responses.set(request, response);
      const result = await fetch(request, () => false) ?? new Response(null, { status: 404 });
      response.writeHead(result.status, [...result.headers].flat());
      if (!result.body || message.method === "HEAD") { await result.body?.cancel(); response.end(); }
      else await pipeline(Readable.fromWeb(result.body as ReadableStream), response);
    } catch {
      if (!response.headersSent) response.writeHead(500).end();
      else response.destroy();
    }
  };
  const plain = createServer(handle);
  plain.on("connection", socket => {
    plaintext.add(socket);
    socket.once("close", () => plaintext.delete(socket));
  });
  const secure = tls && createSecureServer({ key: tls.key, cert: tls.cert }, handle);
  // A TLS connection opens with a handshake record (0x16); anything else is plain HTTP.
  const server = !secure ? plain : createNetServer({ noDelay: true }, socket => {
    socket.setTimeout(10_000, () => socket.destroy());
    socket.once("readable", function first() {
      const byte = socket.read(1) as Buffer | null;
      if (!byte) return void socket.once("readable", first);
      socket.setTimeout(0);
      socket.unshift(byte);
      (byte[0] === 0x16 ? secure : plain).emit("connection", socket);
    });
  });
  // The mux's inner HTTP servers never listen, so Node's closeAllConnections()
  // has no connection tracker. Own the accepted sockets, including clients that
  // have not sent a first byte or completed TLS yet.
  const connections = new Set<NetSocket>();
  server.on("connection", socket => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: websocket.maxPayload });
  // Drop sockets that miss a ping round.
  const alive = new WeakSet<WebSocket>();
  const upgrade = async (message: IncomingMessage, stream: NetSocket, head: Buffer) => {
    let upgraded = false;
    stream.on("error", () => {});
    if (insecure(message)) return void stream.destroy();
    try {
      const result = await fetch(toRequest(message), data => {
        upgraded = true;
        sockets.handleUpgrade(message, stream, head, raw => {
          alive.add(raw);
          raw.on("pong", () => alive.add(raw));
          raw.on("error", () => {});
          if (typeof data === "function") return (data as (socket: WebSocket, request: IncomingMessage) => void)(raw, message);
          const socket = Object.assign(raw, { data: data as T });
          socket.on("message", (value, binary) => websocket.message(socket, binary ? null : value.toString()));
          socket.on("close", () => websocket.close(socket));
          websocket.open(socket);
        });
        return true;
      });
      if (upgraded) return;
      const status = result?.status ?? 404;
      const body = result ? Buffer.from(await result.arrayBuffer()) : Buffer.alloc(0);
      const headers = [...result?.headers ?? []].map(([name, value]) => `${name}: ${value}\r\n`).join("");
      stream.end(Buffer.concat([Buffer.from(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ""}\r\n${headers}Content-Length: ${body.length}\r\nConnection: close\r\n\r\n`), body]));
    } catch { if (!upgraded) stream.destroy(); }
  };
  for (const each of [plain, secure]) each?.on("upgrade", upgrade);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => { server.off("error", reject); resolve(); });
  });
  // Failed binds return no listener to stop; start background work only once listening.
  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!alive.delete(socket)) socket.terminate();
      else socket.ping();
    }
  }, 30_000);
  heartbeat.unref();
  let stopping: Promise<void> | undefined;
  return {
    port: (server.address() as AddressInfo).port,
    setAllowHttp: (enabled, current) => {
      allowHttp = enabled;
      const serving = current && responses.get(current)?.socket;
      if (tls && !enabled) for (const socket of plaintext) if (!loopbackPeer(socket.remoteAddress ?? "")) {
        if (socket === serving) afterResponse(current!, () => socket.destroy());
        else socket.destroy();
      }
    },
    stop: () => stopping ??= new Promise<void>(resolve => {
      clearInterval(heartbeat);
      for (const socket of sockets.clients) socket.terminate();
      server.close(() => resolve());
      for (const socket of connections) socket.destroy();
    }),
  };
}
