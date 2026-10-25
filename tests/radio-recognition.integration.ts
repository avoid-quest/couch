import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as immediate } from "node:timers/promises";
import { test } from "node:test";
import { ControllerError } from "../src/server/devices";
import { createPublicMediaProxy } from "../src/server/public-media-proxy";
import { lookupPublic } from "../src/server/public-network";
import { RadioError } from "../src/server/radio";
import { createRadioRecognition, sampleRadio } from "../src/server/radio-recognition";
import { SongRecognitionError } from "../src/server/song-recognition";

const stationId = "01234567-89ab-4cde-8fab-0123456789ab";
const source = "https://radio.example/stream";
const station = (id: string) => {
  if (id !== stationId) throw new RadioError("Radio station not found.", 404);
  return { source };
};
const post = (body: unknown = { stationId }, signal?: AbortSignal) => new Request("http://localhost/api/radio/recognize", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
});
const allow = () => {};

test("recognition is manual, resolves only the saved station, and returns an uncached no-match observation", async () => {
  let samples = 0, matches = 0;
  const audio = Buffer.from("fixture");
  const recognition = createRadioRecognition({ station, signal: new AbortController().signal,
    sample: async (url, signal) => { assert.equal(url, source); assert.equal(signal.aborted, false); samples++; return { pcm: audio, sampledAt: 1_700_000_000_000 }; },
    recognize: async value => { assert.equal(value, audio); matches++; return null; },
  });
  await immediate();
  assert.equal(samples, 0);
  const get = await recognition.handle(new Request("http://localhost/api/radio/recognize"), allow);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("Allow"), "POST");
  for (const body of [null, [], {}, { stationId, url: source }, { stationId: 42 }, { url: source }]) {
    assert.equal((await recognition.handle(post(body), allow)).status, 400);
  }
  assert.equal((await recognition.handle(post({ stationId: source }), allow)).status, 404);
  assert.equal((await recognition.handle(new Request("http://localhost/api/radio/recognize", { method: "POST", body: "{}" }), allow)).status, 415);
  assert.equal(samples, 0);
  const response = await recognition.handle(post(), allow);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ["sampledAt", "track"]);
  assert.equal(result.track, null);
  assert.equal(result.sampledAt, 1_700_000_000_000, "the result uses the capture time, not the request time");
  await immediate();
  assert.equal(samples, 1);
  assert.equal(matches, 1);
});

test("authorization is rechecked before recognition and before returning a recognized song", async t => {
  for (const revokedAt of ["sample", "recognize"] as const) await t.test(revokedAt, async () => {
    let authorized = true, matches = 0;
    const authorize = () => { if (!authorized) throw new ControllerError("This device was removed. Pair again.", 401); };
    const recognition = createRadioRecognition({ station, signal: new AbortController().signal,
      sample: async () => { if (revokedAt === "sample") authorized = false; return { pcm: Buffer.from("audio"), sampledAt: Date.now() }; },
      recognize: async () => { matches++; authorized = false; return { title: "Must not escape", provider: "shazam" }; },
    });
    const response = await recognition.handle(post(), authorize);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "This device was removed. Pair again." });
    assert.equal(matches, revokedAt === "sample" ? 0 : 1);
  });
});

test("concurrent manual requests are bounded, cancellation releases the slot, and shutdown stops new work", { timeout: 3000 }, async () => {
  const shutdown = new AbortController(), request = new AbortController();
  const started = Promise.withResolvers<void>();
  let samples = 0, matches = 0;
  const recognition = createRadioRecognition({ station, signal: shutdown.signal,
    sample: async (_url, signal) => {
      if (++samples > 1) return { pcm: Buffer.from("audio"), sampledAt: Date.now() };
      return new Promise<never>((_resolve, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); started.resolve(); });
    },
    recognize: async () => { matches++; return null; },
  });
  const first = recognition.handle(post({ stationId }, request.signal), allow);
  await started.promise;
  assert.equal((await recognition.handle(post(), allow)).status, 429);
  assert.equal((await recognition.handle(post(), allow)).status, 429);
  assert.equal(samples, 1);
  request.abort();
  assert.equal((await first).status, 499);
  assert.equal(matches, 0);
  assert.equal((await recognition.handle(post(), allow)).status, 200);
  assert.equal(samples, 2);
  assert.equal(matches, 1);
  shutdown.abort();
  assert.equal((await recognition.handle(post(), allow)).status, 499);
  assert.equal(samples, 2);
});

test("a provider failure releases the manual-request slot", async () => {
  let attempts = 0;
  const recognition = createRadioRecognition({ station, signal: new AbortController().signal,
    sample: async () => ({ pcm: Buffer.from("audio"), sampledAt: Date.now() }),
    recognize: async () => { if (++attempts === 1) throw new SongRecognitionError("Provider unavailable."); return null; },
  });
  assert.equal((await recognition.handle(post(), allow)).status, 502);
  assert.equal((await recognition.handle(post(), allow)).status, 200);
});

test("canceling while FFmpeg is being provisioned rejects promptly and releases the late helper lease once", { timeout: 3000 }, async () => {
  const started = Promise.withResolvers<void>();
  const helper = Promise.withResolvers<{ path: string; release: () => void }>();
  const controller = new AbortController(), reason = new Error("canceled during provisioning");
  let releases = 0, proxies = 0;
  const pending = sampleRadio(source, controller.signal, {
    helper: () => { started.resolve(); return helper.promise; },
    proxy: async () => { proxies++; throw new Error("A canceled sampler must not create a proxy."); },
  });
  const settled = pending.then(() => new Error("The canceled sample resolved."), error => error);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await started.promise;
    controller.abort(reason);
    const observed = await Promise.race([settled, new Promise<Error>(resolve => {
      timer = setTimeout(() => resolve(new Error("Cancellation waited for helper provisioning.")), 300);
    })]);
    assert.equal(observed, reason);
    assert.equal(releases, 0, "the helper has not been acquired yet");
  } finally {
    clearTimeout(timer);
    helper.resolve({ path: "must-not-run", release() { releases++; } });
    await settled;
    await immediate();
  }
  assert.equal(releases, 1);
  assert.equal(proxies, 0);
});

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}
async function closedProxy(url: string) {
  const { hostname, port } = new URL(url);
  await assert.rejects(new Promise<void>((resolve, reject) => {
    const socket = connect({ host: hostname, port: Number(port) });
    socket.once("connect", () => { socket.destroy(); resolve(); });
    socket.once("error", reject);
  }), { code: "ECONNREFUSED" });
}

test("FFmpeg sampling caps audio, protects nested requests, and cleans up on cancellation", { skip: !process.env.COUCH_TEST_FFMPEG, timeout: 20_000 }, async t => {
  const ffmpeg = process.env.COUCH_TEST_FFMPEG!;
  const input = execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "15", "-ac", "2", "-f", "wav", "pipe:1"], { maxBuffer: 4 * 1024 * 1024 });
  let privateContacts = 0, released = 0;
  const received = Promise.withResolvers<void>(), disconnected = Promise.withResolvers<void>();
  const server = createServer((request, response) => {
    if (request.url === "/secret.ts") privateContacts++;
    if (request.url === "/stall") { response.once("close", disconnected.resolve); received.resolve(); return; }
    if (request.url === "/private.m3u8") {
      response.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      response.end(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:12\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:12,\nhttp://127.0.0.1:${port}/secret.ts\n#EXT-X-ENDLIST\n`);
      return;
    }
    response.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": input.length });
    response.end(input);
  });
  const port = await listen(server);
  t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
  const proxies: string[] = [], checked: string[] = [];
  let preparedAt = 0;
  const dependencies = {
    helper: async () => ({ path: ffmpeg, release() { released++; } }),
    proxy: async (signal: AbortSignal) => {
      const proxy = await createPublicMediaProxy(signal, undefined, async hostname => {
        checked.push(hostname);
        // Only this public-name fixture is routed locally; production uses lookupPublic.
        return hostname === "radio.test" ? [{ address: "127.0.0.1", family: 4 }] : lookupPublic(hostname);
      });
      preparedAt = Date.now();
      proxies.push(proxy.url);
      return proxy;
    },
  };
  await t.test("a 15-second stereo source becomes timestamped 12-second 16 kHz mono PCM", async () => {
    const { pcm, sampledAt } = await sampleRadio(`http://radio.test:${port}/radio.wav`, AbortSignal.timeout(5000), dependencies);
    assert.equal(pcm.length, 12 * 16_000 * 2);
    assert.ok(pcm.some(byte => byte !== 0));
    assert.ok(sampledAt >= preparedAt && sampledAt <= Date.now(), "capture time excludes helper and proxy preparation");
    assert.equal(released, 1);
    await closedProxy(proxies.at(-1)!);
  });
  await t.test("private direct streams and HLS children never reach the destination", async () => {
    for (const url of [`http://127.0.0.1:${port}/secret.ts`, `http://radio.test:${port}/private.m3u8`]) {
      await assert.rejects(sampleRadio(url, AbortSignal.timeout(5000), dependencies), /reachable public radio stream/);
      await closedProxy(proxies.at(-1)!);
    }
    assert.ok(checked.includes("127.0.0.1"));
    assert.equal(privateContacts, 0);
    assert.equal(released, 3);
  });
  await t.test("canceling a stalled stream closes its connection, decoder, proxy, and helper lease", async () => {
    const controller = new AbortController(), reason = new Error("fixture canceled");
    const rejected = assert.rejects(sampleRadio(`http://radio.test:${port}/stall`, controller.signal, dependencies), error => error === reason);
    await received.promise;
    controller.abort(reason);
    await rejected;
    await disconnected.promise;
    assert.equal(released, 4);
    await closedProxy(proxies.at(-1)!);
  });
});

test("an oversized decoder output is killed and its resources are released", { skip: process.platform === "win32", timeout: 5000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "couch-recognition-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = join(directory, "oversized-decoder");
  const started = join(directory, "started");
  await writeFile(executable, `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(started)}, "started"); process.stdout.write(Buffer.alloc(1024 * 1024)); setInterval(() => {}, 1000);\n`, { mode: 0o755 });
  let releases = 0, proxyUrl = "";
  await assert.rejects(sampleRadio(source, AbortSignal.timeout(3000), {
    helper: async () => ({ path: executable, release() { releases++; } }),
    proxy: async signal => { const proxy = await createPublicMediaProxy(signal); proxyUrl = proxy.url; return proxy; },
  }), /reachable public radio stream/);
  assert.equal(await readFile(started, "utf8"), "started", "the fixture must run, rather than fail to launch");
  assert.equal(releases, 1);
  await closedProxy(proxyUrl);
});
