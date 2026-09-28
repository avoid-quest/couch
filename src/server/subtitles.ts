import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import type { ExternalSubtitle, PlayerState } from "../shared/protocol";
import { ControllerError } from "./controllers";
import { STORAGE_ERROR } from "./messages";

export const subtitleSizeLimit = 2 * 1024 * 1024;

/** Browser uploads contain bytes from that controller, never a path on the TV. */
export function createSubtitles(player: () => PlayerState, attach: (playbackId: string, subtitle: ExternalSubtitle) => void) {
  const directory = mkdtempSync(join(tmpdir(), "couch-subtitles-"));
  const files = new Map<string, string>();
  let pending = 0;
  let closed = false;
  const shutdown = new AbortController();
  const current = (id: string) => !closed && player().playbackId === id && ["playing", "paused"].includes(player().status);
  const remove = (path: string) => { rmSync(path, { force: true }); files.delete(path); };
  const retain = (playbackId: string | null) => { for (const [path, owner] of files) if (owner !== playbackId) remove(path); };
  return {
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
        if (Number(request.headers.get("content-length")) > subtitleSizeLimit) return json({ error: "Choose a subtitle file up to 2 MiB." }, 413);
        const reader = request.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (reader) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > subtitleSizeLimit) {
              void reader.cancel().catch(() => {});
              return json({ error: "Choose a subtitle file up to 2 MiB." }, 413);
            }
            chunks.push(value);
          }
        } finally { reader?.releaseLock(); }
        const bytes = Buffer.concat(chunks, size);
        authorize();
        if (!bytes.length) return json({ error: "Choose a subtitle file up to 2 MiB." }, 413);
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
        return json({ error: STORAGE_ERROR("the subtitle") }, 400);
      } finally { pending--; }
    },
    observe(state: PlayerState) {
      // Keep files until native playback acknowledges the replacement or Stop.
      if (state.status === "loading") return;
      retain(state.playbackId);
    },
    stopped: retain,
    close() { closed = true; shutdown.abort(); rmSync(directory, { recursive: true, force: true }); files.clear(); },
  };
}
