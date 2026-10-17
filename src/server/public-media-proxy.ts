import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { connect, type Socket } from "node:net";
import { lookupPublic } from "./public-network";

const hopHeaders = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);
function forwarded(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const connection = String(headers.connection ?? "").toLowerCase().split(",").map(name => name.trim());
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !hopHeaders.has(name) && !connection.includes(name)));
}

/** One authenticated loopback proxy per media task. DNS answers are checked and
 * used as literal connection addresses, including every redirect's new request.
 * The optional Core relay permits only one playback's signed HTTP subtree. */
export async function createPublicMediaProxy(signal: AbortSignal, localRelay?: string, lookup: typeof lookupPublic = lookupPublic): Promise<{ url: string; close: () => Promise<void> }> {
  signal.throwIfAborted();
  const local = localRelay ? new URL(localRelay) : undefined;
  const playback = local && /^\/api\/relay\/([\w-]{1,80})\/(?:playlist|bytes)\/[\w-]+$/.exec(local.pathname)?.[1];
  if (local && (local.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(local.hostname) || local.username || local.password || local.hash || !playback)) throw new Error("Use a signed loopback playback relay.");
  const password = randomBytes(32).toString("base64url");
  const authorization = Buffer.from(`Basic ${Buffer.from(`couch:${password}`).toString("base64")}`);
  const authenticated = (value: string | undefined) => {
    const supplied = Buffer.from(value ?? "");
    return supplied.length === authorization.length && timingSafeEqual(supplied, authorization);
  };
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); socket.on("error", () => {}); return socket; };
  let closed = false;
  async function destination(hostname: string) {
    const [address] = await lookup(hostname.replace(/^\[|\]$/g, ""));
    signal.throwIfAborted();
    if (closed || !address) throw new Error("Extractor proxy closed.");
    return address;
  }
  const server = createServer({ maxHeaderSize: 16 * 1024 }, async (incoming, response) => {
    if (!authenticated(incoming.headers["proxy-authorization"])) {
      response.writeHead(407, { "Proxy-Authenticate": 'Basic realm="Couch extractor"', Connection: "close" });
      response.end();
      return;
    }
    try {
      const target = new URL(incoming.url ?? "");
      if (target.protocol !== "http:" || target.username || target.password || target.hash) throw new Error("Invalid proxy target.");
      const address = local && target.origin === local.origin && target.pathname.startsWith(`/api/relay/${playback}/`)
        ? { address: local.hostname.replace(/^\[|\]$/g, ""), family: local.hostname === "127.0.0.1" ? 4 : 6 }
        : await destination(target.hostname);
      if (incoming.destroyed) return;
      const upstream = httpRequest({ hostname: address.address, family: address.family, port: Number(target.port || 80), method: incoming.method, path: `${target.pathname}${target.search}`, headers: { ...forwarded(incoming.headers), host: target.host }, agent: false, signal }, source => {
        response.writeHead(source.statusCode ?? 502, forwarded(source.headers));
        source.on("error", () => response.destroy());
        source.pipe(response);
      });
      upstream.on("socket", track);
      upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      incoming.on("aborted", () => upstream.destroy());
      response.on("close", () => upstream.destroy());
      incoming.pipe(upstream);
    } catch {
      if (!response.headersSent) response.writeHead(403, { Connection: "close" });
      response.end();
    }
  });
  server.on("connection", track);
  server.on("connect", async (incoming, client, head) => {
    if (!authenticated(incoming.headers["proxy-authorization"])) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Couch extractor"\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    try {
      const target = new URL(`https://${incoming.url}`);
      if (target.username || target.password || target.pathname !== "/" || target.search || target.hash) throw new Error("Invalid CONNECT target.");
      const address = await destination(target.hostname);
      if (client.destroyed) return;
      const upstream = track(connect({ host: address.address, family: address.family, port: Number(target.port || 443), signal }));
      upstream.once("error", () => client.destroy());
      client.once("close", () => upstream.destroy());
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
    } catch { client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); }
  });
  server.maxConnections = 64;
  server.headersTimeout = 5000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  server.unref();
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= new Promise(resolve => {
    closed = true;
    signal.removeEventListener("abort", abort);
    for (const socket of sockets) socket.destroy();
    server.close(() => resolve());
  });
  const abort = () => { void close(); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) { await close(); signal.throwIfAborted(); }
  const address = server.address();
  if (!address || typeof address === "string") { await close(); throw new Error("Extractor proxy did not start."); }
  return { url: `http://couch:${password}@127.0.0.1:${address.port}`, close };
}
