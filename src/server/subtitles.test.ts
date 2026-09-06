import { afterEach, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import type { ExternalSubtitle, PlayerState } from "../shared/protocol";
import { createSubtitles, subtitleSizeLimit } from "./subtitles";

const closers: Array<() => void> = [];
afterEach(() => { for (const close of closers.splice(0)) close(); });
const srt = "1\n00:00:00,000 --> 00:00:20,000\nHello from the remote\n";
function fixture() {
  let state: PlayerState = { playbackId: "first", status: "playing", position: 1, duration: 20, volume: 80, seekable: true, error: null };
  const attached: Array<ExternalSubtitle & { playbackId: string }> = [];
  const subtitles = createSubtitles(() => state, (playbackId, subtitle) => attached.push({ playbackId, ...subtitle }));
  closers.push(() => subtitles.close());
  const upload = (name = "captions.srt", body: BodyInit = srt, playbackId = "first") => subtitles.handle(new Request(`http://localhost/api/subtitles?playbackId=${playbackId}&name=${encodeURIComponent(name)}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body }));
  return { subtitles, attached, upload, replace: (playbackId: string | null, status: PlayerState["status"] = "playing") => { state = { ...state, playbackId, status }; return state; } };
}

test("uploaded bytes use a private generated path and remain until native replacement is acknowledged", async () => {
  const { upload, subtitles, attached, replace } = fixture();
  const response = await upload();
  expect(await response.json()).toEqual({ ok: true });
  const file = attached[0]!;
  expect(file).toMatchObject({ title: "captions.srt", playbackId: "first" });
  expect(await Bun.file(file.source).text()).toBe(srt);
  expect(statSync(file.source).mode & 0o777).toBe(0o600);
  subtitles.observe(replace("second", "loading"));
  expect(existsSync(file.source)).toBe(true);
  subtitles.observe(replace("second"));
  expect(existsSync(file.source)).toBe(false);
});

test("Stop overtakes a partially received upload", async () => {
  const { upload, attached, replace } = fixture();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; controller.enqueue(new TextEncoder().encode(srt)); } });
  const pending = upload("captions.srt", body);
  replace(null, "idle");
  controller.close();
  expect((await pending).status).toBe(409);
  expect(attached).toHaveLength(0);
});

test("uploads reject host paths, unsupported contents, stale sessions and excessive size", async () => {
  const { upload, attached } = fixture();
  for (const name of ["/etc/private.srt", "../secret.srt", "C:\\private.srt", "captions.mp4"]) expect((await upload(name)).status).toBe(400);
  expect((await upload("captions.srt", "no subtitles here")).status).toBe(400);
  expect((await upload("captions.srt", srt, "old")).status).toBe(409);
  expect((await upload("captions.srt", new Uint8Array(subtitleSizeLimit + 1))).status).toBe(413);
  expect(attached).toHaveLength(0);
});

test("file limit bounds each source and native Stop releases files", async () => {
  const { upload, subtitles, attached, replace } = fixture();
  for (let index = 0; index < 20; index++) expect((await upload()).status).toBe(200);
  expect((await upload()).status).toBe(429);
  subtitles.observe(replace(null, "idle"));
  expect(attached.every(file => !existsSync(file.source))).toBe(true);
  replace("first");
  expect((await upload()).status).toBe(200);
});

test("shutdown cancels a pending upload and removes accepted files", async () => {
  const { upload, subtitles, attached } = fixture();
  await upload();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const pending = upload("late.srt", new ReadableStream<Uint8Array>({ start(value) { controller = value; } }));
  subtitles.close();
  controller.enqueue(new TextEncoder().encode(srt));
  controller.close();
  expect((await pending).status).toBe(409);
  expect(attached.every(file => !existsSync(file.source))).toBe(true);
});

test("provider subtitles download with private headers, keep upstream order and reject redirects", async () => {
  const requests: string[] = [];
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    requests.push(request.headers.get("authorization") ?? "");
    if (new URL(request.url).pathname === "/redirect.srt") return Response.redirect("https://untrusted.example/sub.srt");
    if (new URL(request.url).pathname === "/first.srt") await Bun.sleep(30);
    return new Response(srt);
  } });
  try {
    const { subtitles, replace } = fixture();
    const origin = `http://127.0.0.1:${upstream.port}`;
    const result = await subtitles.prepare({ source: `${origin}/movie`, headers: { Authorization: "private-token" }, subtitles: [
      { source: `${origin}/first.srt`, title: "Same name" }, { source: `${origin}/second.srt`, title: "Same name" },
      { source: `${origin}/redirect.srt`, title: "Unavailable" }, { source: "https://untrusted.example/sub.srt", title: "Unsafe" },
    ] }, "first", new AbortController().signal);
    expect(requests).toEqual(["private-token", "private-token", "private-token"]);
    expect(result.subtitles).toHaveLength(2);
    expect(result.subtitles!.every(subtitle => !subtitle.source.startsWith("http"))).toBe(true);
    expect(result.subtitleWarning).toContain("could not be loaded");
    for (const subtitle of result.subtitles!) expect(await Bun.file(subtitle.source).text()).toBe(srt);
    subtitles.observe(replace(null, "idle"));
    expect(result.subtitles!.every(subtitle => !existsSync(subtitle.source))).toBe(true);
  } finally { await upstream.stop(true); }
});

test("Stop cancels a stalled provider subtitle without waiting for its response", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch() { entered.resolve(); await release.promise; return new Response(srt); } });
  try {
    const { subtitles } = fixture();
    const origin = `http://127.0.0.1:${upstream.port}`;
    const controller = new AbortController();
    const pending = subtitles.prepare({ source: `${origin}/movie`, subtitles: [{ source: `${origin}/late.srt`, title: "Late" }] }, "first", controller.signal);
    await entered.promise;
    controller.abort();
    await expect(pending).rejects.toThrow();
  } finally { release.resolve(); await upstream.stop(true); }
});

function pgsPacket(type: number, size = 0) {
  const bytes = Buffer.alloc(13 + size);
  bytes.write("PG"); bytes[10] = type; bytes.writeUInt16BE(size, 11);
  return bytes;
}
const framedPgs = Buffer.concat([pgsPacket(0x16, 11), pgsPacket(0x15, 4), pgsPacket(0x80)]);

test("PGS downloads preserve all bytes privately and reject corrupt, missing, oversized and direct SUP responses", async () => {
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    expect(request.headers.get("authorization")).toBe("private-token");
    const name = new URL(request.url).pathname;
    if (name === "/missing.pgssub") return new Response(null, { status: 404 });
    if (name === "/oversize.pgssub") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(subtitleSizeLimit + 1)); controller.close(); } }));
    return new Response(name === "/truncated.pgssub" ? framedPgs.subarray(0, -1) : name === "/invalid.pgssub" ? Buffer.from("<html>unavailable</html>") : framedPgs);
  } });
  try {
    const { subtitles, replace } = fixture();
    const origin = `http://127.0.0.1:${upstream.port}`;
    const result = await subtitles.prepare({ source: `${origin}/movie`, headers: { Authorization: "private-token" }, subtitleWarning: "Known timing limitation.", subtitles: ["valid.pgssub", "truncated.pgssub", "invalid.pgssub", "missing.pgssub", "oversize.pgssub", "direct.sup"].map(name => ({ source: `${origin}/${name}`, title: name })) }, "first", new AbortController().signal);
    expect(result.subtitles).toHaveLength(1);
    const file = result.subtitles![0]!.source;
    expect(file).toEndWith(".sup");
    expect(Buffer.from(await Bun.file(file).arrayBuffer())).toEqual(framedPgs);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(result.subtitleWarning).toContain("Known timing limitation.");
    expect(result.subtitleWarning).toContain("could not be loaded");
    subtitles.observe(replace("second", "loading"));
    expect(existsSync(file)).toBe(true);
    subtitles.observe(replace("second"));
    expect(existsSync(file)).toBe(false);
  } finally { await upstream.stop(true); }
});

test("shutdown aborts an in-flight PGS download and removes accepted files immediately", async () => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (new URL(request.url).pathname === "/late.pgssub") { entered.resolve(); await release.promise; }
    return new Response(framedPgs);
  } });
  try {
    const { subtitles } = fixture();
    const origin = `http://127.0.0.1:${upstream.port}`;
    const media = (name: string) => ({ source: `${origin}/movie`, subtitles: [{ source: `${origin}/${name}.pgssub`, title: name }] });
    const accepted = await subtitles.prepare(media("valid"), "first", new AbortController().signal);
    const pending = subtitles.prepare(media("late"), "first", new AbortController().signal);
    await entered.promise;
    subtitles.close();
    await expect(Promise.race([pending, Bun.sleep(500).then(() => "download did not abort")])).rejects.toThrow("shutting down");
    expect(existsSync(accepted.subtitles![0]!.source)).toBe(false);
  } finally { release.resolve(); await upstream.stop(true); }
});
