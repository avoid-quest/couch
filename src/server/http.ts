import { createServer, STATUS_CODES, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";

// node:http and ws behind the fetch-style handler Core's routes are written
// against: each request becomes a Request, each Response is written back.
export type Socket<T> = WebSocket & { data: T };
export type Upgrade<T> = (data: T) => boolean;
export type Listener = { port: number; stop: () => Promise<void> };
type Options<T> = {
  hostname: string;
  port: number;
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

function toRequest(message: IncomingMessage, body?: Buffer, signal?: AbortSignal) {
  const headers = new Headers();
  for (const [name, values] of Object.entries(message.headersDistinct)) for (const value of values ?? []) headers.append(name, value);
  const request = new Request(new URL(message.url ?? "/", `http://${message.headers.host ?? "localhost"}`), { method: message.method, headers, ...(body ? { body: body as Uint8Array<ArrayBuffer> } : {}), ...(signal ? { signal } : {}) });
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

export async function serve<T>({ hostname, port, maxRequestBodySize, fetch, websocket }: Options<T>): Promise<Listener> {
  const server = createServer(async (message, response) => {
    try {
      const aborted = new AbortController();
      response.once("close", () => { if (!response.writableFinished) aborted.abort(); });
      const body = message.method === "GET" || message.method === "HEAD" ? undefined : await readBody(message, maxRequestBodySize);
      if (body === null) { response.writeHead(413, { Connection: "close" }).end(); return; }
      const result = await fetch(toRequest(message, body, aborted.signal), () => false) ?? new Response(null, { status: 404 });
      response.writeHead(result.status, [...result.headers].flat()).end(Buffer.from(await result.arrayBuffer()));
    } catch {
      if (!response.headersSent) response.writeHead(500).end();
      else response.destroy();
    }
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
  server.on("upgrade", async (message, stream, head) => {
    let upgraded = false;
    stream.on("error", () => {});
    try {
      const result = await fetch(toRequest(message), data => {
        upgraded = true;
        sockets.handleUpgrade(message, stream, head, raw => {
          const socket = Object.assign(raw, { data });
          alive.add(socket);
          socket.on("pong", () => alive.add(socket));
          socket.on("error", () => {});
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
  });
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
      server.closeAllConnections();
    }),
  };
}
