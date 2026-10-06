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
export type Listener = { port: number; stop: () => Promise<void> };
type Options<T> = {
  hostname: string;
  port: number;
  // Serves HTTPS and plain HTTP on one port. Plain HTTP is for this machine only (localhost is
  // a secure context); the LAN gets a redirect to HTTPS on `securePort` (#644 ticket 8).
  tls?: { key: string; cert: string; securePort?: number };
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
export const requestPeer = (request: Request) => peers.get(request) ?? "";

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
  const insecure = (message: IncomingMessage) => !!tls && !encrypted(message) && !loopbackPeer(message.socket.remoteAddress ?? "");
  const handle = async (message: IncomingMessage, response: ServerResponse) => {
    try {
      if (insecure(message)) {
        const { hostname: host } = new URL(`http://${message.headers.host}`);
        response.writeHead(308, { Location: `https://${host}:${tls!.securePort ?? port}${message.url ?? "/"}` }).end();
        return;
      }
      const aborted = new AbortController();
      response.once("close", () => { if (!response.writableFinished) aborted.abort(); });
      const body = message.method === "GET" || message.method === "HEAD" ? undefined : await readBody(message, maxRequestBodySize);
      if (body === null) { response.writeHead(413, { Connection: "close" }).end(); return; }
      const result = await fetch(toRequest(message, body, aborted.signal), () => false) ?? new Response(null, { status: 404 });
      response.writeHead(result.status, [...result.headers].flat());
      if (!result.body || message.method === "HEAD") { await result.body?.cancel(); response.end(); }
      else await pipeline(Readable.fromWeb(result.body as ReadableStream), response);
    } catch {
      if (!response.headersSent) response.writeHead(500).end();
      else response.destroy();
    }
  };
  const plain = createServer(handle);
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
  const sockets = new WebSocketServer({ noServer: true, maxPayload: websocket.maxPayload });
  // Drop sockets that miss a ping round.
  const alive = new WeakSet<WebSocket>();
  const heartbeat = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!alive.delete(socket)) socket.terminate();
      else socket.ping();
    }
  }, 30_000);
  heartbeat.unref();
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
  return {
    port: (server.address() as AddressInfo).port,
    stop: () => new Promise<void>(resolve => {
      clearInterval(heartbeat);
      for (const socket of sockets.clients) socket.terminate();
      server.close(() => resolve());
      plain.closeAllConnections();
      secure?.closeAllConnections();
    }),
  };
}
