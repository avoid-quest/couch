import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createServer, request } from "node:http";
import { connect, createServer as createTcpServer, type Server, type Socket } from "node:net";
import { test } from "node:test";
import { createPublicMediaProxy } from "../src/server/public-media-proxy";
import { lookupPublic } from "../src/server/public-network";

async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}
const stop = (server: Server) => new Promise<void>(resolve => server.close(() => resolve()));
const auth = (proxy: string) => `Basic ${Buffer.from(`${new URL(proxy).username}:${new URL(proxy).password}`).toString("base64")}`;
function get(proxy: string, target: string, authorized = true): Promise<{ status: number; body: string; location?: string }> {
  const address = new URL(proxy);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: address.hostname, port: address.port, path: target, headers: authorized ? { "Proxy-Authorization": auth(proxy) } : {} }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString(), location: response.headers.location }));
    });
    req.on("error", reject); req.end();
  });
}
function tunnel(proxy: string, target: string, authorized = true): Promise<{ status: number; socket: Socket }> {
  const address = new URL(proxy);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: address.hostname, port: address.port, method: "CONNECT", path: target, headers: authorized ? { "Proxy-Authorization": auth(proxy) } : {} });
    req.on("connect", (response, socket) => resolve({ status: response.statusCode!, socket }));
    req.on("error", reject); req.end();
  });
}

test("extractor proxy authenticates and rejects private HTTP and CONNECT destinations before contact", async () => {
  let contacts = 0;
  const upstream = createServer((_req, response) => { contacts++; response.end("private"); });
  const port = await listen(upstream);
  const proxy = await createPublicMediaProxy(new AbortController().signal);
  try {
    assert.equal((await get(proxy.url, `http://127.0.0.1:${port}/secret`, false)).status, 407);
    assert.equal((await get(proxy.url, `http://127.0.0.1:${port}/secret`)).status, 403);
    assert.equal((await get(proxy.url, `http://[::ffff:127.0.0.1]:${port}/secret`)).status, 403);
    const unauthenticated = await tunnel(proxy.url, `127.0.0.1:${port}`, false);
    assert.equal(unauthenticated.status, 407); unauthenticated.socket.destroy();
    const denied = await tunnel(proxy.url, `127.0.0.1:${port}`);
    assert.equal(denied.status, 403); denied.socket.destroy();
    assert.equal(contacts, 0);
  } finally { await proxy.close(); await stop(upstream); }
});

test("HTTP forwarding pins the checked address, preserves Host and rechecks redirect requests", async () => {
  let contacts = 0;
  const upstream = createServer((req, response) => {
    contacts++;
    assert.equal(req.headers.host, `public.test:${port}`);
    assert.equal(req.headers["proxy-authorization"], undefined);
    if (req.url === "/redirect") { response.writeHead(302, { Location: `http://private.test:${port}/secret` }); response.end(); }
    else response.end("public fixture");
  });
  const port = await listen(upstream);
  const names: string[] = [];
  const proxy = await createPublicMediaProxy(new AbortController().signal, undefined, async hostname => {
    names.push(hostname);
    if (hostname !== "public.test") throw new Error("private address");
    // The injected policy routes a controlled public-name fixture locally.
    // Production lookupPublic never returns a loopback address.
    return [{ address: "127.0.0.1", family: 4 }];
  });
  try {
    assert.equal((await get(proxy.url, `http://public.test:${port}/media`)).body, "public fixture");
    const redirect = await get(proxy.url, `http://public.test:${port}/redirect`);
    assert.equal(redirect.status, 302);
    assert.equal((await get(proxy.url, redirect.location!)).status, 403);
    assert.deepEqual(names, ["public.test", "public.test", "private.test"]);
    assert.equal(contacts, 2);
  } finally { await proxy.close(); await stop(upstream); }
});

test("CONNECT uses the checked address and closes established tunnels on cancellation", async () => {
  const upstream = createTcpServer();
  const sockets = new Set<Socket>();
  upstream.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); socket.on("data", data => socket.write(data)); });
  const port = await listen(upstream);
  const cancellation = new AbortController();
  const names: string[] = [];
  const proxy = await createPublicMediaProxy(cancellation.signal, undefined, async hostname => { names.push(hostname); return [{ address: "127.0.0.1", family: 4 }]; });
  try {
    const established = await tunnel(proxy.url, `public.test:${port}`);
    assert.equal(established.status, 200);
    const data = new Promise<Buffer>(resolve => established.socket.once("data", resolve));
    established.socket.write("tunnel bytes");
    assert.equal(String(await data), "tunnel bytes");
    assert.deepEqual(names, ["public.test"]);
    const closed = new Promise<void>(resolve => established.socket.once("close", resolve));
    cancellation.abort();
    await closed;
    await proxy.close();
    const address = new URL(proxy.url);
    await assert.rejects(new Promise<void>((resolve, reject) => { const socket = connect({ host: address.hostname, port: Number(address.port) }); socket.once("connect", () => { socket.destroy(); resolve(); }); socket.once("error", reject); }));
  } finally { await proxy.close(); for (const socket of sockets) socket.destroy(); await stop(upstream); }
});

test("a native task may reach only its configured loopback relay playback subtree", async () => {
  const requests: string[] = [];
  const upstream = createServer((req, response) => { requests.push(req.url!); response.end("relay fixture"); });
  const port = await listen(upstream);
  const origin = `http://127.0.0.1:${port}`;
  const relay = `${origin}/api/relay/current/playlist/signature?url=https%3A%2F%2Fpublic.test%2Fmaster.m3u8`;
  const proxy = await createPublicMediaProxy(new AbortController().signal, relay);
  try {
    assert.equal((await get(proxy.url, relay)).body, "relay fixture");
    assert.equal((await get(proxy.url, `${origin}/api/relay/current/bytes/child-signature?url=https%3A%2F%2Fpublic.test%2Fsegment.ts`)).body, "relay fixture");
    for (const target of [`${origin}/api/settings`, `${origin}/api/relay/other/bytes/signature`, `${origin}/api/relay/current/../other/bytes/signature`, `${origin}/api/relay/current/%2e%2e/other/bytes/signature`, `http://127.0.0.1:${port + 1}/api/relay/current/bytes/signature`, `https://127.0.0.1:${port}/api/relay/current/bytes/signature`]) assert.equal((await get(proxy.url, target)).status, 403, target);
    const denied = await tunnel(proxy.url, `127.0.0.1:${port}`);
    assert.equal(denied.status, 403); denied.socket.destroy();
    assert.equal(requests.length, 2);
    for (const invalid of [`${origin}/api/settings`, `${origin}/api/relay/current/bytes/signature#fragment`, relay.replace("127.0.0.1", "localhost"), relay.replace("http:", "https:"), relay.replace("http://", "http://name:secret@")]) await assert.rejects(() => createPublicMediaProxy(new AbortController().signal, invalid), /signed loopback playback relay/);
  } finally { await proxy.close(); await stop(upstream); }
});

test("FFmpeg follows an extensionless signed relay but cannot follow its private HLS child", { skip: !process.env.COUCH_TEST_FFMPEG }, async () => {
  const ffmpeg = process.env.COUCH_TEST_FFMPEG!;
  const segment = execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "0.1", "-c:a", "aac", "-f", "mpegts", "pipe:1"]);
  let privateContacts = 0;
  const privateServer = createServer((_req, response) => { privateContacts++; response.end(segment); });
  const privatePort = await listen(privateServer);
  let malicious = false;
  const gateway = createServer((req, response) => {
    if (req.url?.startsWith("/api/relay/current/bytes/")) { response.writeHead(200, { "Content-Type": "video/mp2t" }); response.end(segment); return; }
    response.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
    response.end(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:0.1,\n${malicious ? `http://127.0.0.1:${privatePort}/secret.ts` : `http://127.0.0.1:${port}/api/relay/current/bytes/segment-signature?url=https%3A%2F%2Fpublic.test%2Fsegment.ts`}\n#EXT-X-ENDLIST\n`);
  });
  const port = await listen(gateway);
  const relay = `http://127.0.0.1:${port}/api/relay/current/playlist/signature?url=https%3A%2F%2Fpublic.test%2Fmaster.m3u8`;
  const checked: string[] = [];
  const proxy = await createPublicMediaProxy(new AbortController().signal, relay, async hostname => { checked.push(hostname); return lookupPublic(hostname); });
  const decode = () => new Promise<{ code: number | string; stderr: string }>(resolve => execFile(ffmpeg, ["-hide_banner", "-nostdin", "-loglevel", "error", "-protocol_whitelist", "http,https,tcp,tls,crypto,httpproxy", "-rw_timeout", "3000000", "-http_proxy", proxy.url, "-format_whitelist", "aac,ac3,aiff,ape,asf,flac,flv,hls,matroska,webm,mov,mp3,mpeg,mpegts,ogg,wav,wv", "-i", relay, "-t", "0.05", "-f", "null", "-"], { signal: AbortSignal.timeout(8000), env: { ...process.env, http_proxy: proxy.url, https_proxy: proxy.url, NO_PROXY: "", no_proxy: "" } }, (error, _stdout, stderr) => resolve({ code: error?.code ?? 0, stderr })));
  try {
    const allowed = await decode();
    assert.equal(allowed.code, 0, allowed.stderr);
    malicious = true;
    const denied = await decode();
    assert.notEqual(denied.code, 0);
    assert.match(denied.stderr, /Error when loading first segment.*secret\.ts/);
    assert.ok(checked.includes("127.0.0.1"), "the nested request reached the proxy's public-address policy");
    assert.equal(privateContacts, 0);
  } finally { await proxy.close(); await stop(gateway); await stop(privateServer); }
});
