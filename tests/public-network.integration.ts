import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { connectPublic, isPublicAddress, lookupPublic, publicFetch, publicLookup, PublicNetworkError } from "../src/server/public-network";
import { createPassThrough } from "../src/server/pass-through";

test("only public IPv4 and global IPv6 addresses pass", () => {
  for (const address of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2001:4860:4860::8888", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(address), true, address);
  for (const address of ["", "example.com", "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.0.0.1", "192.0.2.1", "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255", "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:8.8.8.8", "64:ff9b::a00:1", "64:ff9b:1::1", "100::1", "2001::1", "2001:db8::1", "2002:7f00:1::", "3fff::1", "fc00::1", "fe80::1", "ff02::1", "2606:4700::1%lo"]) assert.equal(isPublicAddress(address), false, address);
});

test("lookup returns the exact checked answers and rejects mixed or empty DNS results", async t => {
  let answers: dns.LookupAddress[] = [{ address: "93.184.216.34", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }];
  let calls = 0;
  t.mock.method(dns, "lookup", (_host: string, options: dns.LookupOptions, callback: (error: null, rows: dns.LookupAddress[]) => void) => {
    calls++; assert.equal(options.all, true); callback(null, answers);
  });
  assert.deepEqual(await lookupPublic("public.test"), answers);
  assert.equal(calls, 1);
  const all = await new Promise((resolve, reject) => publicLookup("public.test", { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses)));
  assert.deepEqual(all, answers);
  const single = await new Promise((resolve, reject) => publicLookup("public.test", {}, (error, address, family) => error ? reject(error) : resolve({ address, family })));
  assert.deepEqual(single, answers[0]);
  answers = [...answers, { address: "127.0.0.1", family: 4 }];
  await assert.rejects(() => lookupPublic("public.test"), PublicNetworkError);
  answers = [];
  await assert.rejects(() => lookupPublic("public.test"), PublicNetworkError);
});

test("literal and DNS private targets never reach a local sentinel", async t => {
  let hits = 0;
  const server = http.createServer((_request, response) => { hits++; response.end("must not be reached"); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const port = (server.address() as import("node:net").AddressInfo).port;
  let lookups = 0;
  t.mock.method(dns, "lookup", (_host: string, _options: dns.LookupOptions, callback: (error: null, rows: dns.LookupAddress[]) => void) => { lookups++; callback(null, [{ address: "127.0.0.1", family: 4 }]); });
  for (const host of ["127.0.0.1", "127.1", "2130706433", "0x7f000001", "0177.0.0.1", "[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "private.test"]) await assert.rejects(() => publicFetch(`http://${host}:${port}/`), PublicNetworkError);
  assert.equal(lookups, 1);
  assert.throws(() => connectPublic("127.0.0.1", port), PublicNetworkError);
  const socket = connectPublic("private.test", port);
  await assert.rejects(() => once(socket, "connect"), PublicNetworkError);
  assert.equal(hits, 0);
});

test("aborting a pending socket lookup rejects without a connection", async t => {
  let lookups = 0;
  t.mock.method(dns, "lookup", () => { lookups++; });
  const abort = new AbortController();
  const pending = publicFetch("https://pending.public.test/", { signal: abort.signal });
  await Promise.resolve();
  abort.abort();
  await assert.rejects(() => pending, error => error instanceof Error && error.name === "AbortError");
  assert.equal(lookups, 1);
});

test("public HLS relay rejects signed private variants, keys and segments before sentinel contact", async t => {
  let contacts = 0;
  const sentinel = http.createServer((_request, response) => { contacts++; response.end("private sentinel"); });
  sentinel.listen(0, "127.0.0.1");
  await once(sentinel, "listening");
  t.after(() => new Promise<void>((resolve, reject) => sentinel.close(error => error ? reject(error) : resolve())));
  const local = `http://127.0.0.1:${(sentinel.address() as import("node:net").AddressInfo).port}`;
  const master = "https://public-media.test/master.m3u8";
  const manifests = [
    `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n${local}/variant.m3u8\n`,
    `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-KEY:METHOD=AES-128,URI="${local}/key"\n#EXTINF:1,\n${local}/segment.ts\n#EXT-X-ENDLIST\n`,
  ];
  const denied: string[] = [];
  for (const manifest of manifests) {
    const request = (async (input, init) => {
      if (String(input) !== master) return publicFetch(input, init);
      const response = new Response(manifest, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } });
      Object.defineProperty(response, "url", { value: master });
      return response;
    }) as typeof fetch;
    const relay = createPassThrough(id => id === "guarded", request);
    const media = await relay.prepare("guarded", { source: master, publicNetwork: true }, {}, { origin: "https://couch.test", userAgent: "Security fixture" }, AbortSignal.timeout(1000));
    const rewritten = await (await relay.serve(new Request(media.source))).text();
    const children = [...rewritten.matchAll(/URI="([^"]+)"/g)].map(match => match[1]!);
    children.push(...rewritten.split("\n").filter(line => line && !line.startsWith("#")));
    for (const child of children) {
      const upstream = new URL(child).searchParams.get("url")!;
      denied.push(new URL(upstream).pathname);
      assert.equal((await relay.serve(new Request(child, { signal: AbortSignal.timeout(1000) }))).status, 502);
    }
  }
  assert.deepEqual(denied, ["/variant.m3u8", "/key", "/segment.ts"]);
  assert.equal(contacts, 0);
});

test("Core's media listener is literal loopback, guarded, media-only and closed with pending requests", async t => {
  let contacts = 0;
  const sentinel = http.createServer((_request, response) => { contacts++; response.end("private sentinel"); });
  sentinel.listen(0, "127.0.0.1");
  await once(sentinel, "listening");
  t.after(() => new Promise<void>((resolve, reject) => sentinel.close(error => error ? reject(error) : resolve())));
  const port = (sentinel.address() as import("node:net").AddressInfo).port;
  const master = "https://public-media.test/master.m3u8";
  let hold = false, pendingSignal: AbortSignal | undefined;
  const started = Promise.withResolvers<void>();
  const request = (async (input, init) => {
    if (String(input) !== master) return publicFetch(input, init);
    if (hold) return new Promise<Response>((_resolve, reject) => {
      pendingSignal = init?.signal ?? undefined;
      pendingSignal!.addEventListener("abort", () => reject(pendingSignal!.reason), { once: true });
      started.resolve();
    });
    const response = new Response(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nhttp://127.0.0.1:${port}/private.m3u8\n`, { headers: { "Content-Type": "application/vnd.apple.mpegurl" } });
    Object.defineProperty(response, "url", { value: master });
    return response;
  }) as typeof fetch;
  const relay = createPassThrough(id => id === "core", request);
  t.after(() => relay.close());
  const origin = await relay.coreOrigin();
  assert.equal(new URL(origin).protocol, "http:");
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  const media = await relay.prepare("core", { source: master, publicNetwork: true }, {}, { origin, userAgent: "Core fixture" }, AbortSignal.timeout(1000));
  const masterResponse = await fetch(media.source);
  assert.equal(masterResponse.status, 200);
  const child = (await masterResponse.text()).split("\n").find(line => line && !line.startsWith("#"))!;
  assert.equal(new URL(child).origin, origin);
  assert.equal((await fetch(child)).status, 502);
  assert.equal((await fetch(`${origin}/api/settings`)).status, 404);
  assert.equal(contacts, 0);
  hold = true;
  const pending = fetch(media.source).then(() => false, () => true);
  await started.promise;
  await relay.close();
  assert.equal(await pending, true);
  assert.equal(pendingSignal?.aborted, true);
  await assert.rejects(() => relay.coreOrigin(), /closed/);
  await assert.rejects(new Promise<void>((resolve, reject) => {
    const connection = http.get(`${origin}/api/settings`, { agent: false }, response => { response.resume(); resolve(); });
    connection.once("error", reject);
  }));
});

type Spec = { status?: number; headers?: Record<string, string>; body?: string | Uint8Array | Readable };
type Call = { url: URL; options: http.RequestOptions; upload: string; response?: http.IncomingMessage };

// Exercise socket lookup and HTTP streaming without allowing private test peers
// through the production guard. Only the HTTP transport is replaced here.
function transport(t: TestContext, route: (call: Call) => Spec) {
  const calls: Call[] = [];
  t.mock.method(dns, "lookup", (_host: string, _options: dns.LookupOptions, callback: (error: null, rows: dns.LookupAddress[]) => void) => callback(null, [{ address: "93.184.216.34", family: 4 }]));
  const request = (url: URL, options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
    const call: Call = { url, options, upload: "" };
    calls.push(call);
    const stream = new PassThrough({ autoDestroy: false });
    stream.on("data", chunk => { call.upload += chunk.toString(); });
    const abort = () => stream.destroy(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    options.signal?.addEventListener("abort", abort, { once: true });
    stream.once("close", () => { options.signal?.removeEventListener("abort", abort); call.response?.destroy(); });
    stream.once("finish", () => options.lookup!(url.hostname, { all: false }, (error, address) => {
      if (error) { stream.destroy(error); return; }
      assert.equal(address, "93.184.216.34");
      const spec = route(call);
      const response = (spec.body instanceof Readable ? spec.body : Readable.from([typeof spec.body === "string" ? Buffer.from(spec.body) : spec.body ?? Buffer.alloc(0)])) as http.IncomingMessage;
      response.statusCode = spec.status ?? 200;
      response.statusMessage = "OK";
      response.rawHeaders = Object.entries(spec.headers ?? {}).flat();
      response.headers = Object.fromEntries(Object.entries(spec.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
      call.response = response;
      callback(response);
    }));
    return stream as unknown as http.ClientRequest;
  };
  t.mock.method(http, "request", request);
  t.mock.method(https, "request", request);
  return calls;
}

test("public fetch preserves the original URL host and streams its response", async t => {
  const calls = transport(t, () => ({ headers: { "Content-Type": "text/plain", "Set-Cookie": "anonymous=yes" }, body: "public content" }));
  const response = await publicFetch("https://media.public.test:8443/video", { headers: { Host: "private.test" } });
  assert.equal(response.status, 200);
  assert.equal(response.url, "https://media.public.test:8443/video");
  assert.equal(response.redirected, false);
  assert.equal(response.headers.getSetCookie()[0], "anonymous=yes");
  assert.equal(await response.text(), "public content");
  assert.equal(calls[0]?.url.hostname, "media.public.test");
  assert.equal((calls[0]?.options.headers as Record<string, string>).host, "media.public.test:8443");
  assert.equal(calls[0]?.options.lookup, publicLookup);
  assert.notEqual(calls[0]?.options.agent, https.globalAgent);
});

test("redirects cannot reach private literals, credentials or a rebound DNS answer", async t => {
  for (const destination of ["http://127.0.0.1/private", "http://[::ffff:127.0.0.1]/private", "http://169.254.169.254/key", "https://user:secret@public.test/private", "file:///etc/passwd"]) {
    const calls = transport(t, () => ({ status: 302, headers: { Location: destination } }));
    await assert.rejects(() => publicFetch("https://public.test/master.m3u8"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.response?.destroyed, true);
    t.mock.restoreAll();
  }
  const calls = transport(t, () => ({ status: 302, headers: { Location: "https://rebound.test/child.m3u8" } }));
  let lookups = 0;
  t.mock.method(dns, "lookup", (_host: string, _options: dns.LookupOptions, callback: (error: null, rows: dns.LookupAddress[]) => void) => callback(null, [{ address: ++lookups === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }]));
  await assert.rejects(() => publicFetch("https://public.test/master.m3u8"), PublicNetworkError);
  assert.equal(calls.length, 2);
  assert.equal(lookups, 2);
  assert.equal(calls[1]?.response, undefined);
});

test("public redirects strip credentials, change POST to GET, and expose the final URL", async t => {
  const calls = transport(t, call => call.url.hostname === "public.test" ? { status: 303, headers: { Location: "https://cdn.public.test/final" } } : { body: "done" });
  const response = await publicFetch("https://public.test/start", { method: "POST", body: "payload", headers: { Authorization: "Bearer private", Cookie: "session=private" } });
  assert.equal(await response.text(), "done");
  assert.equal(response.url, "https://cdn.public.test/final");
  assert.equal(response.redirected, true);
  assert.equal(calls[0]?.upload, "payload");
  assert.equal(calls[1]?.options.method, "GET");
  assert.equal(calls[1]?.upload, "");
  const headers = calls[1]?.options.headers as Record<string, string>;
  assert.equal(headers.host, "cdn.public.test");
  assert.equal(headers.authorization, undefined);
  assert.equal(headers.cookie, undefined);
  assert.equal(headers["content-type"], undefined);
});

test("manual and forbidden redirects do not issue another request; loops are bounded", async t => {
  const calls = transport(t, () => ({ status: 302, headers: { Location: "/next" } }));
  const response = await publicFetch("https://public.test/start", { redirect: "manual" });
  assert.equal(response.status, 302);
  await response.body?.cancel();
  assert.equal(calls.length, 1);
  await assert.rejects(() => publicFetch("https://public.test/start", { redirect: "error" }), /redirected/);
  assert.equal(calls.length, 2);
  await assert.rejects(() => publicFetch("https://public.test/start"), /redirected/);
  assert.equal(calls.length, 23);
});

test("body cancellation and request abortion stop streams", async t => {
  const streams: Readable[] = [];
  const calls = transport(t, () => {
    const body = new Readable({ read() { this.push(Buffer.from("data")); this._read = () => {}; } });
    streams.push(body);
    return { body };
  });
  const response = await publicFetch("https://public.test/live");
  await response.body!.cancel();
  assert.equal(streams[0]?.destroyed, true);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(() => publicFetch("https://public.test/live", { signal: abort.signal }), error => error instanceof DOMException && error.name === "AbortError");
  assert.equal(calls.length, 1);
  const reading = new AbortController();
  const live = await publicFetch("https://public.test/live", { signal: reading.signal });
  const pending = live.text();
  reading.abort();
  await assert.rejects(() => pending);
  assert.equal(streams[1]?.destroyed, true);
});

test("uploads stream with Node's duplex requirement and replay finite bodies on 307", async t => {
  const calls = transport(t, call => call.url.pathname === "/start" ? { status: 307, headers: { Location: "/final" } } : { body: "done" });
  const upload = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("streamed upload")); controller.close(); } });
  assert.equal(await (await publicFetch("https://public.test/final", { method: "POST", body: upload })).text(), "done");
  assert.equal(calls[0]?.upload, "streamed upload");
  assert.equal(await (await publicFetch("https://public.test/start", { method: "POST", body: "replayed upload" })).text(), "done");
  assert.equal(calls[1]?.upload, "replayed upload");
  assert.equal(calls[2]?.upload, "replayed upload");
});

test("compressed responses decode without stale length headers and HEAD stays bodyless", async t => {
  const compressed = gzipSync("decoded public response");
  transport(t, () => ({ headers: { "Content-Encoding": "gzip", "Content-Length": String(compressed.length) }, body: compressed }));
  const response = await publicFetch("https://public.test/data");
  assert.equal(await response.text(), "decoded public response");
  assert.equal(response.headers.has("content-encoding"), false);
  assert.equal(response.headers.has("content-length"), false);
  assert.equal((await publicFetch("https://public.test/data", { method: "HEAD" })).body, null);
});
