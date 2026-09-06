import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import type { ExternalSubtitle, PlayerState } from "../shared/protocol";
import type { MediaSource } from "./session";
import { ControllerError } from "./controllers";

export const subtitleSizeLimit = 2 * 1024 * 1024;

function validPgs(bytes: Buffer) {
  let composition = false, object = false, last = 0;
  for (let position = 0; position < bytes.length;) {
    if (position + 13 > bytes.length || bytes.readUInt16BE(position) !== 0x5047) return false;
    const type = bytes[position + 10]!, size = bytes.readUInt16BE(position + 11);
    if (![0x14, 0x15, 0x16, 0x17, 0x80].includes(type) || position + 13 + size > bytes.length) return false;
    if (type === 0x80 ? size !== 0 : size === 0) return false;
    composition ||= type === 0x16 && size >= 11;
    object ||= type === 0x15 && size >= 4;
    last = type;
    position += 13 + size;
  }
  return composition && object && last === 0x80;
}

/** Browser uploads contain bytes from that controller, never a path on the TV. */
export function createSubtitles(player: () => PlayerState, attach: (playbackId: string, subtitle: ExternalSubtitle) => void) {
  const directory = mkdtempSync(join(tmpdir(), "couch-subtitles-"));
  const files = new Map<string, string>();
  let pending = 0;
  let closed = false;
  const shutdown = new AbortController();
  const current = (id: string) => !closed && player().playbackId === id && ["playing", "paused"].includes(player().status);
  const remove = (path: string) => { rmSync(path, { force: true }); files.delete(path); };
  return {
    async prepare(media: MediaSource, playbackId: string, signal: AbortSignal): Promise<MediaSource> {
      if (!media.subtitles?.length) return media;
      const downloaded: Array<ExternalSubtitle | undefined> = [];
      const paths: string[] = [];
      const timeout = AbortSignal.any([signal, shutdown.signal, AbortSignal.timeout(8_000)]);
      let failed = media.subtitles.length > 20;
      let index = 0;
      try {
        await Promise.all(Array.from({ length: Math.min(4, media.subtitles.length) }, async () => {
          while (index < Math.min(20, media.subtitles!.length)) {
            const currentIndex = index++;
            const subtitle = media.subtitles![currentIndex]!;
            try {
              const url = new URL(subtitle.source);
              if (!["http:", "https:"].includes(url.protocol) || url.origin !== new URL(media.source).origin) throw new Error();
              const response = await fetch(url, { headers: media.headers, signal: timeout, redirect: "error" });
              if (!response.ok || !response.body || Number(response.headers.get("Content-Length")) > subtitleSizeLimit) { await response.body?.cancel(); throw new Error(); }
              const reader = response.body.getReader();
              const chunks: Uint8Array[] = [];
              let size = 0;
              try {
                for (;;) {
                  const { value, done } = await reader.read();
                  timeout.throwIfAborted();
                  if (done) break;
                  size += value.length;
                  if (size > subtitleSizeLimit) throw new Error();
                  chunks.push(value);
                }
              } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
              if (!size || closed) throw new Error();
              signal.throwIfAborted();
              const upstreamExtension = extname(url.pathname).toLowerCase();
              if (![".srt", ".ass", ".ssa", ".vtt", ".pgssub"].includes(upstreamExtension)) throw new Error();
              const extension = upstreamExtension === ".pgssub" ? ".sup" : upstreamExtension;
              const bytes = Buffer.concat(chunks);
              if (extension === ".sup" && !validPgs(bytes)) throw new Error();
              const path = join(directory, `${crypto.randomUUID()}${extension}`);
              writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
              paths.push(path);
              files.set(path, playbackId);
              downloaded[currentIndex] = { ...subtitle, source: path };
            } catch { failed = true; }
          }
        }));
        signal.throwIfAborted();
        if (closed) throw new Error("The player is shutting down.");
        return { ...media, subtitles: downloaded.filter((subtitle): subtitle is ExternalSubtitle => !!subtitle), ...(failed ? { subtitleWarning: [media.subtitleWarning, "Some external subtitles could not be loaded. Try again or add a text subtitle file."].filter(Boolean).join(" ") } : {}) };
      } catch (error) { paths.forEach(remove); throw error; }
    },
    async handle(request: Request, authorize = () => {}) {
      const json = (body: unknown, status = 200) => Response.json(body, { status });
      if (request.method !== "POST") return json({ error: "Use POST to add a subtitle file." }, 405);
      const url = new URL(request.url);
      const playbackId = url.searchParams.get("playbackId") ?? "";
      const name = url.searchParams.get("name") ?? "";
      const extension = extname(name).toLowerCase();
      if (!current(playbackId)) return json({ error: "The playing item changed. Choose a subtitle for the current item." }, 409);
      if (!name || name.length > 160 || /[\\/\u0000-\u001f\u007f]/.test(name) || ![".srt", ".ass", ".ssa", ".vtt"].includes(extension)) return json({ error: "Choose an SRT, ASS, SSA or WebVTT subtitle file." }, 400);
      if (request.headers.get("content-type") !== "application/octet-stream") return json({ error: "Send the subtitle file as binary data." }, 415);
      if (pending >= 4 || files.size + pending >= 20) return json({ error: "Too many subtitle files. Start another item before adding more." }, 429);
      pending++;
      let path: string | undefined;
      try {
        const bytes = new Uint8Array(await request.arrayBuffer());
        authorize();
        if (!bytes.length || bytes.length > subtitleSizeLimit) return json({ error: "Choose a subtitle file up to 2 MiB." }, 413);
        const content = new TextDecoder().decode(bytes);
        if (content.includes("\0") || (extension === ".ass" || extension === ".ssa" ? !/\[Events\]/i.test(content) : !/\d{2}:\d{2}[,.]\d{3}\s+-->/.test(content))) return json({ error: "This file does not contain supported text subtitles." }, 400);
        // Reading the upload yields. Stop or a newer source must win that race.
        if (!current(playbackId)) return json({ error: "The playing item changed. Choose a subtitle for the current item." }, 409);
        path = join(directory, `${crypto.randomUUID()}${extension}`);
        writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
        attach(playbackId, { source: path, title: name });
        files.set(path, playbackId);
        return json({ ok: true });
      } catch (error) {
        if (path) remove(path);
        if (error instanceof ControllerError) return json({ error: error.message }, error.status);
        return json({ error: "Could not add the subtitle. Check the current playback and the TV's storage." }, 400);
      } finally { pending--; }
    },
    observe(state: PlayerState) {
      // Keep files until native playback acknowledges the replacement or Stop.
      if (state.status === "loading") return;
      for (const [path, playbackId] of files) if (state.playbackId !== playbackId) remove(path);
    },
    close() { closed = true; shutdown.abort(); rmSync(directory, { recursive: true, force: true }); files.clear(); },
  };
}
