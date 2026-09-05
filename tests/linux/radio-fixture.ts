import { createHash } from "node:crypto";

export type RadioMode = "metadata" | "plain" | "flaky" | "failed" | "eof" | "disconnect" | "stall";
type RadioCase = { mode: RadioMode; title: string; artist?: string; requests: number };
export type RadioRequest = { key: string; method: string; at: number; attempt: number; mode: RadioMode; status: number; icy: boolean; userAgent: string | null; credentials: boolean; closedAt?: number; reason?: string };
export const initialRadioTitle = "Fixture artist - Morning signal";
export const changedRadioTitle = '<b data-radio-fixture="tag">Evening signal</b>';
export const suppliedRadioArtist = "Fixture album artist";

function withoutId3(bytes: Uint8Array) {
  let start = 0;
  if (Buffer.from(bytes.subarray(0, 3)).toString() === "ID3") {
    start = 10 + ((bytes[6]! & 127) << 21) + ((bytes[7]! & 127) << 14) + ((bytes[8]! & 127) << 7) + (bytes[9]! & 127);
    if (bytes[5]! & 16) start += 10;
  }
  const end = Buffer.from(bytes.subarray(-128, -125)).toString() === "TAG" ? bytes.length - 128 : bytes.length;
  if (start >= end) throw new Error("Radio fixture has no MP3 audio after ID3 tags");
  return bytes.slice(start, end);
}

function artistTag(artist: string) {
  const text = Buffer.concat([Buffer.from([0]), Buffer.from(artist, "latin1")]);
  const frame = Buffer.alloc(10 + text.length);
  frame.write("TPE1", 0);
  frame.writeUInt32BE(text.length, 4);
  text.copy(frame, 10);
  const header = Buffer.from([73, 68, 51, 3, 0, 0, 0, 0, 0, 0]);
  for (let i = 0; i < 4; i++) header[9 - i] = (frame.length >> (7 * i)) & 127;
  return Buffer.concat([header, frame]);
}

function metadataBlock(title: string) {
  const text = Buffer.from(`StreamTitle='${title}';`, "utf8");
  const blocks = Math.ceil(text.length / 16);
  if (blocks > 255 || title.includes("'")) throw new Error("Invalid ICY fixture title");
  const data = Buffer.alloc(1 + blocks * 16);
  data[0] = blocks;
  text.copy(data, 1);
  return data;
}

// Real MP3 bytes, ICY framing and paced responses exercise libmpv's HTTP reader.
// Each case has its own URL, so counts include every native attempt and cannot
// hide retries behind a reset counter. There is no application test endpoint.
export async function createRadioFixture(mediaPath = "/fixtures/radio.mp3", port = 4201) {
  const original = new Uint8Array(await Bun.file(mediaPath).arrayBuffer());
  const audio = withoutId3(original);
  const cases = new Map<string, RadioCase>();
  const requests: RadioRequest[] = [];
  const active = new Set<() => void>();
  const interval = 2048;
  // The source fixture is ten seconds long. Match its encoded byte rate.
  const tickMs = Math.max(30, Math.round(interval * 10_000 / audio.length));
  const server = Bun.serve({
    hostname: "127.0.0.1", port, idleTimeout: 0,
    fetch(request) {
      const key = new URL(request.url).pathname.slice(1);
      const fixture = cases.get(key);
      if (!fixture) return new Response("Unknown radio fixture", { status: 404 });
      const attempt = ++fixture.requests;
      const failed = fixture.mode === "failed" || (fixture.mode === "flaky" && attempt === 1);
      const record: RadioRequest = {
        key, method: request.method, at: Date.now(), attempt, mode: fixture.mode, status: failed ? 503 : 200,
        icy: request.headers.get("icy-metadata") === "1", userAgent: request.headers.get("user-agent"),
        credentials: request.headers.has("authorization") || request.headers.has("x-emby-token"),
      };
      requests.push(record);
      if (failed) { record.closedAt = Date.now(); record.reason = "HTTP 503"; return new Response("Fixture station is unavailable", { status: 503 }); }
      const icy = fixture.mode === "metadata" && record.icy;
      let sent = 0;
      let cursor = 0;
      const prefix = fixture.artist ? artistTag(fixture.artist) : new Uint8Array();
      let timer: ReturnType<typeof setInterval> | undefined;
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const finish = (reason: string, error = false) => {
        if (record.closedAt) return;
        record.closedAt = Date.now(); record.reason = reason;
        clearInterval(timer);
        active.delete(close);
        request.signal.removeEventListener("abort", abort);
        try { if (error) controller.error(new Error(reason)); else controller.close(); } catch { /* The peer may have cancelled first. */ }
      };
      const close = () => finish("Fixture server closed");
      const abort = () => finish("Native request aborted");
      const body = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
          active.add(close);
          request.signal.addEventListener("abort", abort, { once: true });
          timer = setInterval(() => {
            const elapsed = Date.now() - record.at;
            if (fixture.mode === "eof" && elapsed >= 4_000) { finish("Deliberate clean EOF"); return; }
            if (fixture.mode === "disconnect" && elapsed >= 4_000) { finish("Deliberate connection loss", true); return; }
            if (fixture.mode === "stall" && elapsed >= 1_500) return;
            if (controller.desiredSize !== null && controller.desiredSize < 0) return;
            const chunk = Buffer.alloc(interval);
            for (let i = 0; i < chunk.length; i++, sent++) {
              if (sent < prefix.length) chunk[i] = prefix[sent]!;
              else { chunk[i] = audio[cursor]!; cursor = (cursor + 1) % audio.length; }
            }
            controller.enqueue(icy ? Buffer.concat([chunk, metadataBlock(fixture.title)]) : chunk);
          }, tickMs);
        },
        cancel() { finish("Native stream cancelled"); },
      });
      return new Response(body, { headers: {
        "content-type": "audio/mpeg", "cache-control": "no-store", "accept-ranges": "none",
        "icy-name": "Acceptance station", ...(icy ? { "icy-metaint": String(interval) } : {}),
      } });
    },
  });
  return {
    source: { path: mediaPath, sha256: createHash("sha256").update(original).digest("hex"), bytes: original.length, audioBytes: audio.length, interval, tickMs },
    add(mode: RadioMode, artist?: string) {
      const key = `${mode}-${crypto.randomUUID()}`;
      cases.set(key, { mode, title: initialRadioTitle, artist, requests: 0 });
      return { key, url: `http://127.0.0.1:${server.port}/${key}` };
    },
    setTitle(key: string, title: string) { metadataBlock(title); cases.get(key)!.title = title; },
    recover(key: string) { cases.get(key)!.mode = "plain"; },
    requests: (key?: string) => structuredClone(key ? requests.filter(request => request.key === key) : requests),
    async close() { for (const close of [...active]) close(); await server.stop(true); },
  };
}

export type RadioFixture = Awaited<ReturnType<typeof createRadioFixture>>;
