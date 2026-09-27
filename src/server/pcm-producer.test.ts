import { afterEach, expect, test } from "bun:test";
import { createServer, type Server, type Socket } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlaybackCommand, PlayerState } from "../shared/protocol";
import { createPcmProducer } from "./pcm-producer";

const directories: string[] = [];
const producers: ReturnType<typeof createPcmProducer>[] = [];
const sources: ReturnType<typeof Bun.serve>[] = [];
const listeners: Server[] = [];
const sockets = new Set<Socket>();
const ffmpeg = Bun.which("ffmpeg");
const qualified = ffmpeg ? test : test.skip;
afterEach(async () => {
  await Promise.all(producers.splice(0).map(producer => producer.close()));
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(listeners.splice(0).map(listener => new Promise<void>(resolve => listener.close(() => resolve()))));
  for (const source of sources.splice(0)) source.stop(true);
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const waitFor = async (check: () => boolean, timeout = 5000) => {
  const deadline = performance.now() + timeout;
  while (!check()) { if (performance.now() > deadline) throw new Error("Timed out waiting for audio fixture."); await Bun.sleep(10); }
};
function wave(seconds: number) {
  const pcm = Buffer.alloc(Math.round(seconds * 48_000) * 4);
  for (let at = 0; at < pcm.length; at += 4) {
    const sample = Math.round(Math.sin(at / 4 * 2 * Math.PI * 440 / 48_000) * 8000);
    pcm.writeInt16LE(sample, at); pcm.writeInt16LE(sample, at + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(pcm.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48_000, 24); header.writeUInt32LE(192_000, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
function source(seconds: number, wav = wave(seconds), contentType = "audio/wav") {
  const requests: Request[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    requests.push(request);
    if (new URL(request.url).pathname === "/bad") return new Response("invalid media");
    const start = Number(request.headers.get("range")?.match(/^bytes=(\d+)-/)?.[1] ?? 0);
    if (start >= wav.length) return new Response(null, { status: 416 });
    return new Response(wav.subarray(start), { status: request.headers.has("range") ? 206 : 200, headers: { "Content-Type": contentType, "Accept-Ranges": "bytes", "Content-Length": String(wav.length - start), ...(request.headers.has("range") ? { "Content-Range": `bytes ${start}-${wav.length - 1}/${wav.length}` } : {}) } });
  } });
  sources.push(server);
  return { url: `http://127.0.0.1:${server.port}/tone.wav`, requests };
}
async function sink() {
  const chunks: { at: number; size: number }[] = [];
  let connections = 0;
  const listener = createServer(socket => {
    sockets.add(socket); connections++;
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", bytes => chunks.push({ at: performance.now(), size: bytes.length }));
  });
  listeners.push(listener);
  await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as { port: number }).port;
  return { port, chunks, connections: () => connections, bytes: () => chunks.reduce((sum, chunk) => sum + chunk.size, 0) };
}
function producer(port: number, options: Partial<Parameters<typeof createPcmProducer>[0]> = {}) {
  const observations: PlayerState[] = [];
  const player = createPcmProducer({ host: "127.0.0.1", port, bufferMs: 40, drainMs: 80, ffmpeg: ffmpeg ?? undefined, observe: state => observations.push(state), ...options });
  producers.push(player);
  return { player, observations, last: () => observations.at(-1)! };
}
const load = (source: string, duration?: number, extra = {}) => ({ type: "load", playbackId: "audio", source, duration, ...extra }) as PlaybackCommand;

qualified("real decoder prepares silently, streams paced stereo PCM, pauses after drain and resumes", async () => {
  const media = source(3);
  const output = await sink();
  const { player, last } = producer(output.port);
  await player.send(load(media.url, 3, { paused: true, headers: { Authorization: "private-fixture-token" } }));
  expect(last()).toMatchObject({ status: "paused", position: 0, seekable: true, audioTracksKnown: false, positionEstimated: true });
  expect(output.connections()).toBe(0);
  expect(media.requests[0]!.headers.get("authorization")).toBe("private-fixture-token");
  await player.send({ type: "pause", playbackId: "audio", paused: false });
  await waitFor(() => output.bytes() >= 3840 * 12);
  expect(output.chunks.at(-1)!.at - output.chunks[0]!.at).toBeGreaterThan(180);
  await player.send({ type: "pause", playbackId: "audio", paused: true });
  const stopped = output.bytes();
  const position = last().position;
  expect(last().status).toBe("paused");
  expect(position).toBeGreaterThan(0.1);
  expect(position).toBeLessThan(1);
  await Bun.sleep(100);
  expect(output.bytes()).toBe(stopped);
  await player.send({ type: "pause", playbackId: "audio", paused: false });
  await waitFor(() => output.connections() === 2 && output.bytes() > stopped);
  await player.send({ type: "stop" });
  expect(last()).toMatchObject({ status: "idle", playbackId: null });
});

qualified("known VOD seeks and changes tempo while paused, then reaches drained EOF", async () => {
  const media = source(1.2);
  const output = await sink();
  const { player, last } = producer(output.port);
  await player.send(load(media.url, 1.2, { paused: true }));
  await player.send({ type: "seek", playbackId: "audio", position: 0.7 });
  expect(last()).toMatchObject({ status: "paused", position: 0.7 });
  await player.send({ type: "speed", playbackId: "audio", speed: 2 });
  expect(last()).toMatchObject({ status: "paused", speed: 2 });
  await player.send({ type: "pause", playbackId: "audio", paused: false });
  await waitFor(() => last().status === "ended");
  expect(last().position).toBeGreaterThan(1.1);
  expect(last().position).toBeLessThanOrEqual(1.2);
  expect(output.bytes()).toBeGreaterThan(20_000);
  expect(output.bytes()).toBeLessThan(60_000);
});

qualified("decoder and socket failures report errors without retaining a stream", async () => {
  const media = source(1);
  const output = await sink();
  const bad = producer(output.port);
  await bad.player.send(load(new URL("/bad", media.url).href));
  expect(bad.last().status).toBe("error");
  expect(output.connections()).toBe(0);
  const refused = producer(1);
  await refused.player.send(load(media.url, 1));
  await waitFor(() => refused.last().status === "error");
  expect(refused.last().error).not.toContain(media.url);
});

qualified("closing a pending decoder fences later observations and permanently rejects commands", async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } })) });
  sources.push(server);
  const output = await sink();
  const { player, observations } = producer(output.port);
  const loading = player.send(load(`http://127.0.0.1:${server.port}/slow`));
  await Bun.sleep(30);
  await player.close();
  await loading;
  const count = observations.length;
  await Bun.sleep(50);
  expect(observations.length).toBe(count);
  expect(output.connections()).toBe(0);
  await expect(player.send({ type: "stop" })).rejects.toThrow("closed");
});

test("rejects filesystem inputs, injected headers and unsupported processing before spawning", async () => {
  const { player } = producer(1, { ffmpeg: "/does-not-exist" });
  for (const command of [load("file:///private/file"), load("https://example.org/audio", undefined, { headers: { Authorization: "secret\r\nOther: injected" } }), load("https://example.org/audio", undefined, { segment: { start: 0, end: 2 } }), load("https://example.org/audio", undefined, { preferences: { replayGain: "track" } })]) await expect(player.send(command)).rejects.toThrow();
  await expect(player.send({ type: "volume", volume: 10 })).rejects.toThrow("does not support");
});

qualified("unknown duration and radio never claim seekability", async () => {
  const media = source(1);
  const output = await sink();
  const { player, last } = producer(output.port);
  for (const command of [load(media.url, undefined, { paused: true }), load(media.url, 1, { paused: true, radio: true })]) {
    await player.send(command);
    expect(last().seekable).toBeFalse();
    await expect(player.send({ type: "seek", playbackId: "audio", position: 0 })).rejects.toThrow("cannot seek");
  }
});


qualified("cancel interrupts preparation promptly and a later load remains usable", async () => {
  const stalled = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } })) });
  sources.push(stalled);
  const media = source(1);
  const output = await sink();
  const { player, observations, last } = producer(output.port);
  const loading = player.send(load(`http://127.0.0.1:${stalled.port}/slow`));
  await Bun.sleep(30);
  const started = performance.now();
  player.cancel();
  await loading;
  await player.send({ type: "stop" });
  expect(performance.now() - started).toBeLessThan(500);
  expect(observations.some(state => state.status === "error")).toBeFalse();
  expect(last().status).toBe("idle");
  await player.send(load(media.url, 1));
  await waitFor(() => output.bytes() > 0);
  player.cancel();
  await player.send({ type: "stop" });
  expect(last().status).toBe("idle");
});

qualified("ingestion loss is an error and cannot acknowledge a silent stopped group", async () => {
  const media = source(2);
  const listener = createServer(socket => { sockets.add(socket); socket.on("error", () => {}); socket.once("data", () => socket.destroy()); });
  listeners.push(listener);
  await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  const { player, last } = producer((listener.address() as { port: number }).port);
  await player.send(load(media.url, 2));
  await waitFor(() => last().status === "error");
  await expect(player.send({ type: "stop" })).rejects.toThrow("uncertain");
  expect(last().status).toBe("error");
});

qualified("qualified buffer delays the estimated clock and drain precedes pause acknowledgement", async () => {
  const media = source(2);
  const output = await sink();
  const { player, last } = producer(output.port, { bufferMs: 500, drainMs: 750 });
  await player.send(load(media.url, 2));
  await waitFor(() => output.bytes() >= 3840 * 3);
  expect(last().position).toBe(0);
  const started = performance.now();
  await player.send({ type: "pause", playbackId: "audio", paused: true });
  expect(performance.now() - started).toBeGreaterThanOrEqual(700);
  expect(last().position).toBeGreaterThanOrEqual(0.06);
  expect(last().position).toBeLessThan(0.2);
  expect(last().status).toBe("paused");
});

qualified("long VOD remains bounded and playing after a paused seek and restart", async () => {
  const media = source(60);
  const output = await sink();
  const { player, last } = producer(output.port);
  await player.send(load(media.url, 60, { paused: true }));
  await player.send({ type: "seek", playbackId: "audio", position: 30 });
  await player.send({ type: "pause", playbackId: "audio", paused: false });
  await waitFor(() => output.bytes() >= 192_000 || last().status === "error");
  expect(last().error).toBeNull();
  expect(last().status).not.toBe("error");
  expect(output.bytes()).toBeGreaterThanOrEqual(192_000);
});

qualified("both supported tempo extremes prepare real audio without opening ingestion", async () => {
  const media = source(1);
  const output = await sink();
  const { player, last } = producer(output.port);
  for (const speed of [0.25, 4]) {
    await player.send(load(media.url, 1, { paused: true, preferences: { speed } }));
    expect(last()).toMatchObject({ status: "paused", speed, error: null });
    expect(output.connections()).toBe(0);
  }
});


// Run starvation regressions outside the test process so its watchdog can still
// kill a broken reader, rather than freezing the entire test suite's timers.
async function isolatedDecoder(command: PlaybackCommand, executable: string, port: number, resume = false) {
  const code = `
    import { createPcmProducer } from ${JSON.stringify(join(import.meta.dir, "pcm-producer.ts"))};
    let state, beats = 0;
    const timer = setInterval(() => beats++, 5);
    const producer = createPcmProducer({ host: "127.0.0.1", port: ${port}, bufferMs: 40, drainMs: 80, ffmpeg: ${JSON.stringify(executable)}, observe: value => state = value });
    try {
      await producer.send(${JSON.stringify(command)});
      if (${resume}) {
        await producer.send({ type: "pause", playbackId: "audio", paused: false });
        await Bun.sleep(300);
      } else await Bun.sleep(30);
      const result = { state, beats };
      console.log(JSON.stringify(result));
    } finally { await producer.close(); clearInterval(timer); }
  `;
  const child = Bun.spawn([process.execPath, "-e", code], { stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(4000), killSignal: "SIGKILL" });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
  return JSON.parse(stdout) as { state: PlayerState; beats: number };
}

test("partial PCM socket batches cannot starve timers during paused preparation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-split-pcm-")); directories.push(directory);
  const executable = join(directory, "split-decoder");
  writeFileSync(executable, `#!${process.execPath}
import { createConnection } from "node:net";
const url = new URL(process.argv.at(-1));
const socket = createConnection({ host: url.hostname, port: Number(url.port) });
socket.on("error", () => {});
socket.once("connect", async () => {
  socket.write(Buffer.alloc(7));
  await Bun.sleep(40);
  socket.write(Buffer.alloc(3833));
  await Bun.sleep(80);
  socket.end();
});
`, { mode: 0o700 });
  const result = await isolatedDecoder(load("http://fixture.invalid/audio", 1, { paused: true }), executable, 1);
  expect(result.state).toMatchObject({ status: "paused", error: null, position: 0 });
  expect(result.beats).toBeGreaterThan(5);
}, 10_000);

qualified("MP4 AAC paused seek at 1.25x leaves Core timers responsive", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-aac-pcm-")); directories.push(directory);
  const file = join(directory, "tone.mp4");
  const encoded = Bun.spawnSync([ffmpeg!, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=90", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", file]);
  expect(encoded.exitCode).toBe(0);
  const media = source(90, Buffer.from(await Bun.file(file).arrayBuffer()), "audio/mp4");
  const output = await sink();
  const result = await isolatedDecoder(load(media.url, 90, { paused: true, startPosition: 25, preferences: { speed: 1.25 } }), ffmpeg!, output.port, true);
  expect(result.state).toMatchObject({ status: "playing", speed: 1.25, error: null });
  expect(result.state.position).toBeGreaterThan(25);
  expect(result.beats).toBeGreaterThan(20);
  expect(output.bytes()).toBeGreaterThan(20_000);
}, 10_000);
