import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { connect, createServer, type Socket } from "node:net";
import { connect as connectTLS, type TLSSocket } from "node:tls";
import WebSocket from "ws";
import { certificate } from "../src/server/certificate";
import { serve } from "../src/server/http";

type Mode = "plain" | "shared-http" | "shared-https";
const modes: Mode[] = ["plain", "shared-http", "shared-https"];
// Deadlines diagnose a stuck listener; cleanup destroys clients even on the red baseline.
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not complete within 1000ms`)), 1000); })]);
  } finally { clearTimeout(timer!); }
}

async function fixture(t: TestContext, mode: Mode, fetch: Parameters<typeof serve<string>>[0]["fetch"] = async () => new Response("ok"), hostname = "127.0.0.1") {
  const directory = await mkdtemp(join(tmpdir(), "couch-http-shutdown-"));
  const tls = await certificate(directory, ["localhost", "127.0.0.1"]);
  const generic = { opens: 0, closes: 0 }, genericClosed = Promise.withResolvers<void>();
  const listener = await serve<string>({ hostname, port: 0, ...(mode === "plain" ? {} : { tls: { ...tls, securePort: 8443 } }), maxRequestBodySize: 8, fetch,
    websocket: { maxPayload: 1024, open(socket) { generic.opens++; assert.equal(socket.data, "generic"); }, message(socket, message) { socket.send(message ?? "binary"); }, close() { generic.closes++; genericClosed.resolve(); } },
  });
  const clients: Array<Socket | WebSocket> = [];
  t.after(async () => {
    for (const client of clients) { if (client instanceof WebSocket) client.terminate(); else client.destroy(); }
    try { await bounded(listener.stop(), "fixture cleanup"); } finally { await rm(directory, { recursive: true, force: true }); }
  });
  async function client(secure = mode === "shared-https", host = "127.0.0.1") {
    const socket = secure ? connectTLS({ host, port: listener.port, ca: tls.cert, allowPartialTrustChain: true, rejectUnauthorized: true }) : connect(listener.port, host);
    clients.push(socket);
    socket.on("error", () => {});
    await bounded(once(socket, secure ? "secureConnect" : "connect"), "client connection");
    if (secure) assert.equal((socket as TLSSocket).authorized, true);
    return socket;
  }
  async function ws(path: string) {
    const socket = new WebSocket(`${mode === "shared-https" ? "wss" : "ws"}://127.0.0.1:${listener.port}${path}`, { ca: tls.cert, allowPartialTrustChain: true, rejectUnauthorized: true });
    clients.push(socket);
    socket.on("error", () => {});
    await bounded(once(socket, "open"), "WebSocket upgrade");
    return socket;
  }
  return { listener, client, ws, generic, genericClosed: genericClosed.promise };
}

function request(socket: Socket, path = "/", extra = "", method = "GET") {
  socket.write(`${method} ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n${extra}\r\n`);
}
function dataUntil(socket: Socket, predicate: (text: string) => boolean) {
  return bounded(new Promise<string>((resolve, reject) => {
    let text = "";
    const data = (chunk: Buffer) => { text += chunk.toString(); if (predicate(text)) { cleanup(); resolve(text); } };
    const close = () => { cleanup(); reject(new Error(`Client closed before expected response: ${text}`)); };
    const cleanup = () => { socket.off("data", data); socket.off("close", close); };
    socket.on("data", data); socket.once("close", close);
  }), "response");
}
async function stopped(listener: Awaited<ReturnType<typeof serve>>, socket: Socket) {
  const closed = once(socket, "close");
  await bounded(Promise.all([listener.stop(), closed]), "stop and client close");
  assert.equal(socket.destroyed, true);
}

for (const mode of modes) {
  test(`${mode}: completed keep-alive closes before concurrent and repeated stop settle`, { timeout: 5000 }, async t => {
    const f = await fixture(t, mode);
    const socket = await f.client();
    for (let i = 0; i < 2; i++) {
      const response = dataUntil(socket, text => text.endsWith("0\r\n\r\n"));
      request(socket); assert.match(await response, /^HTTP\/1.1 200/);
      assert.equal(socket.destroyed, false);
    }
    const closed = once(socket, "close");
    await bounded(Promise.all([f.listener.stop(), f.listener.stop(), closed]), "concurrent stop");
    await bounded(f.listener.stop(), "repeated stop");
    assert.equal(socket.destroyed, true);
    const probe = connect(f.listener.port, "127.0.0.1");
    probe.on("error", () => {});
    try { const [error] = await bounded(once(probe, "error"), "closed listener"); assert.equal(error.code, "ECONNREFUSED"); }
    finally { probe.destroy(); }
  });

  test(`${mode}: stop interrupts a slow request body before dispatch`, { timeout: 5000 }, async t => {
    let called = false;
    const f = await fixture(t, mode, async () => { called = true; return new Response("unexpected"); });
    const socket = await f.client();
    request(socket, "/", "Content-Length: 8\r\n", "POST"); socket.write("a");
    // Allow the request parser to begin waiting on the remaining body.
    await new Promise(resolve => setTimeout(resolve, 20));
    await stopped(f.listener, socket);
    assert.equal(called, false);
  });

  test(`${mode}: stop aborts an in-flight handler`, { timeout: 5000 }, async t => {
    const entered = Promise.withResolvers<void>(), aborted = Promise.withResolvers<void>();
    const f = await fixture(t, mode, async request => {
      request.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
      entered.resolve(); await aborted.promise; return new Response("aborted");
    });
    const socket = await f.client(); request(socket);
    await bounded(entered.promise, "handler entry");
    await stopped(f.listener, socket); await bounded(aborted.promise, "request cancellation");
  });

  test(`${mode}: stop cancels a slow response stream`, { timeout: 5000 }, async t => {
    const aborted = Promise.withResolvers<void>(), cancelled = Promise.withResolvers<void>();
    const f = await fixture(t, mode, async request => {
      request.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("first")); }, cancel() { cancelled.resolve(); } }));
    });
    const socket = await f.client(); const response = dataUntil(socket, text => text.includes("first")); request(socket); await response;
    await stopped(f.listener, socket);
    await bounded(Promise.all([aborted.promise, cancelled.promise]), "response cancellation");
  });

  test(`${mode}: peer disconnect still cancels a response without stopping the listener`, { timeout: 5000 }, async t => {
    const aborted = Promise.withResolvers<void>();
    const f = await fixture(t, mode, async request => {
      if (new URL(request.url).pathname === "/ok") return new Response("ok");
      request.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("first")); } }));
    });
    const socket = await f.client(), response = dataUntil(socket, text => text.includes("first")); request(socket); await response;
    socket.destroy(); await bounded(aborted.promise, "peer cancellation");
    const next = await f.client(), completed = dataUntil(next, text => text.endsWith("0\r\n\r\n")); request(next, "/ok"); assert.match(await completed, /^HTTP\/1.1 200/);
  });

  test(`${mode}: generic and custom WebSocket owners receive messages and close on stop`, { timeout: 5000 }, async t => {
    let customCloses = 0; const customClosed = Promise.withResolvers<void>();
    const f = await fixture(t, mode, async (request, upgrade) => {
      if (new URL(request.url).pathname === "/custom") upgrade(socket => {
        socket.on("message", data => socket.send(`custom:${data}`)); socket.once("close", () => { customCloses++; customClosed.resolve(); });
      }); else upgrade("generic");
      return undefined;
    });
    const generic = await f.ws("/generic"), custom = await f.ws("/custom");
    const echo = once(generic, "message"); generic.send("hello"); assert.equal(String((await bounded(echo, "generic echo"))[0]), "hello");
    const customEcho = once(custom, "message"); custom.send("hello"); assert.equal(String((await bounded(customEcho, "custom echo"))[0]), "custom:hello");
    assert.equal(f.generic.opens, 1);
    const closes = [once(generic, "close"), once(custom, "close")];
    await bounded(Promise.all([f.listener.stop(), ...closes, f.genericClosed, customClosed.promise]), "WebSocket shutdown");
    assert.equal(f.generic.closes, 1); assert.equal(customCloses, 1);
  });

  test(`${mode}: request conversion, HEAD, body limit and rejected upgrade remain intact`, { timeout: 5000 }, async t => {
    const f = await fixture(t, mode, async request => {
      const path = new URL(request.url).pathname;
      assert.equal(new URL(request.url).protocol, mode === "shared-https" ? "https:" : "http:");
      if (path === "/upgrade") return new Response("denied", { status: 403, headers: { "X-Reason": "fixture" } });
      if (path === "/missing") return undefined;
      if (path === "/error") throw new Error("fixture");
      if (path === "/head") return new Response("hidden", { headers: { "X-Fixture": "head" } });
      return new Response(await request.text(), { headers: { "Content-Type": "text/plain" } });
    });
    for (const [path, method, extra, body, status, expected] of [
      ["/", "POST", "Content-Length: 3\r\nX-Fixture: one\r\n", "abc", 200, "abc"],
      ["/head", "HEAD", "", "", 200, ""], ["/", "POST", "Content-Length: 9\r\n", "123456789", 413, ""],
      ["/missing", "GET", "", "", 404, ""], ["/error", "GET", "", "", 500, ""],
      ["/upgrade", "GET", "Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n", "", 403, "denied"],
    ] as const) {
      const socket = await f.client(); const response = dataUntil(socket, text => text.includes("\r\n\r\n") && (!expected || text.includes(expected)));
      request(socket, path, extra, method); if (body) socket.write(body);
      const text = await response; assert.match(text, new RegExp(`^HTTP/1.1 ${status}`));
      if (method === "HEAD") assert.equal(text.split("\r\n\r\n")[1], "");
      socket.destroy();
    }
  });
}

for (const mode of ["plain", "shared-http"] as const) {
  test(`${mode}: stop closes an accepted client that sent no first byte`, { timeout: 5000 }, async t => {
    const f = await fixture(t, mode), socket = await f.client();
    await new Promise(resolve => setTimeout(resolve, 20));
    await stopped(f.listener, socket);
  });
}

test("shared TLS: stop closes a partial handshake and a completed handshake without HTTP", { timeout: 5000 }, async t => {
  const f = await fixture(t, "shared-https"), pending = await f.client(false), ready = await f.client();
  pending.write(Buffer.from([0x16, 0x03, 0x01, 0x00, 0x10, 0x01]));
  await new Promise(resolve => setTimeout(resolve, 20));
  const closes = [once(pending, "close"), once(ready, "close")];
  await bounded(Promise.all([f.listener.stop(), ...closes]), "pending TLS shutdown");
});

const lanAddress = Object.values(networkInterfaces()).flat().find(address => address?.family === "IPv4" && !address.internal)?.address;
test("shared listener retains the LAN HTTP redirect and refuses insecure upgrades", { skip: !lanAddress, timeout: 5000 }, async t => {
  let calls = 0;
  const f = await fixture(t, "shared-http", async () => { calls++; return new Response("unexpected"); }, "0.0.0.0");
  const socket = await f.client(false, lanAddress), response = dataUntil(socket, text => text.includes("\r\n\r\n"));
  socket.write("GET /a?b=c HTTP/1.1\r\nHost: couch.example:1234\r\nConnection: keep-alive\r\n\r\n");
  const text = await response; assert.match(text, /^HTTP\/1.1 308/); assert.ok(text.includes("Location: https://couch.example:8443/a?b=c"));
  const upgrade = await f.client(false, lanAddress), closed = once(upgrade, "close");
  request(upgrade, "/", "Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n");
  await bounded(closed, "insecure upgrade refusal"); assert.equal(calls, 0);
});

// A failed constructor has no returned stop() for its caller to invoke.
for (const secure of [false, true]) {
  test(`${secure ? "TLS mux" : "plain HTTP"}: failed binds release heartbeat timers before retry`, async t => {
    const directory = await mkdtemp(join(tmpdir(), "couch-bind-cleanup-"));
    const tls = secure ? await certificate(directory, ["localhost", "127.0.0.1"]) : undefined;
    const blocker = createServer();
    blocker.listen(0, "127.0.0.1");
    await once(blocker, "listening");
    const address = blocker.address();
    assert.ok(address && typeof address !== "string");
    const timers = new Set<ReturnType<typeof setInterval>>();
    const set = globalThis.setInterval, clear = globalThis.clearInterval;
    t.mock.method(globalThis, "setInterval", (...args: Parameters<typeof setInterval>) => {
      const timer = set(...args); timers.add(timer); return timer;
    });
    t.mock.method(globalThis, "clearInterval", (timer: Parameters<typeof clearInterval>[0]) => {
      timers.delete(timer as ReturnType<typeof setInterval>); clear(timer);
    });
    let listener: Awaited<ReturnType<typeof serve>> | undefined;
    t.after(async () => {
      await listener?.stop();
      if (blocker.listening) await new Promise<void>(resolve => blocker.close(() => resolve()));
      for (const timer of timers) clear(timer);
      await rm(directory, { recursive: true, force: true });
    });
    const start = () => serve({ hostname: "127.0.0.1", port: address.port, tls, maxRequestBodySize: 4096,
      fetch: async () => Response.json({ ok: true }),
      websocket: { maxPayload: 4096, open() {}, message() {}, close() {} },
    });
    for (let attempt = 0; attempt < 3; attempt++) await assert.rejects(start(), { code: "EADDRINUSE" });
    assert.equal(timers.size, 0, "failed binds retained active heartbeat intervals");
    await new Promise<void>(resolve => blocker.close(() => resolve()));
    listener = await start();
    assert.equal((await fetch(`http://127.0.0.1:${listener.port}`)).status, 200);
    await listener.stop();
    assert.equal(timers.size, 0, "successful recovery retained heartbeat intervals after stop");
  });
}
