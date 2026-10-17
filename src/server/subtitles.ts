import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { extname } from "node:path";
import type { ExternalSubtitle, PlayerState } from "../shared/protocol";
import { ControllerError } from "./devices";
import { STORAGE_ERROR } from "./messages";
import { boundedBytes } from "./iptv-feeds";
import { publicFetch } from "./public-network";

export const subtitleSizeLimit = 2 * 1024 * 1024;
const cues = /\d{2}:\d{2}[,.]\d{3}\s+-->/;
const webVtt = (content: string, srt: boolean) => srt ? `WEBVTT\n\n${content.replace(/^\uFEFF/, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}` : content;

const key = randomBytes(32);
const sign = (url: string) => createHmac("sha256", key).update(url).digest("base64url");
// A source's own subtitles (yt-dlp's) come through Core, which signs their address: a <track> reads only its page's origin.
export const sourceSubtitle = (url: string) => `/api/subtitles/${sign(url)}.vtt?${new URLSearchParams({ url })}`;

/**
 * Uploads contain bytes from that Device, never a path on the TV. Every Device plays
 * WebVTT in a <track>, so SRT is converted and each file is served from memory at an
 * unguessable address (a <track> request carries no credentials).
 */
// `player` finds the player that plays `playbackId`, in whichever Playback (#644 ticket 9).
export function createSubtitles(player: (playbackId: string) => PlayerState | undefined, attach: (playbackId: string, subtitle: ExternalSubtitle) => void, publicRequest: typeof fetch = publicFetch) {
  const files = new Map<string, { playbackId: string; text: string }>();
  let pending = 0;
  let closed = false;
  const current = (id: string) => !closed && ["playing", "paused"].includes(player(id)?.status ?? "");
  // Files live while their item plays, until its player acknowledges a replacement or Stop.
  const retain = (_playbackId?: string | null) => { for (const [path, file] of files) if (player(file.playbackId)?.status === undefined) files.delete(path); };
  return {
    async handle(request: Request, authorize = () => {}) {
      const json = (body: unknown, status = 200) => Response.json(body, { status });
      if (request.method !== "POST") return json({ error: "Use POST to add a subtitle file." }, 405);
      const url = new URL(request.url);
      const playbackId = url.searchParams.get("playbackId") ?? "";
      const name = url.searchParams.get("name") ?? "";
      const extension = extname(name).toLowerCase();
      if (!current(playbackId)) return json({ error: "The playing item changed. Choose a subtitle for the current item." }, 409);
      if (!name || name.length > 160 || /[\\/\u0000-\u001f\u007f]/.test(name) || ![".srt", ".vtt"].includes(extension)) return json({ error: "Choose an SRT or WebVTT subtitle file." }, 400);
      if (request.headers.get("content-type") !== "application/octet-stream") return json({ error: "Send the subtitle file as binary data." }, 415);
      if (pending >= 4 || files.size + pending >= 20) return json({ error: "Too many subtitle files. Start another item before adding more." }, 429);
      pending++;
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
        if (content.includes("\0") || !cues.test(content)) return json({ error: "This file does not contain supported text subtitles." }, 400);
        // Reading the upload yields. Stop or a newer source must win that race.
        if (!current(playbackId)) return json({ error: "The playing item changed. Choose a subtitle for the current item." }, 409);
        const path = `/api/subtitles/${crypto.randomUUID()}.vtt`;
        files.set(path, { playbackId, text: webVtt(content, extension !== ".vtt") });
        attach(playbackId, { source: path, title: name });
        return json({ ok: true });
      } catch (error) {
        if (error instanceof ControllerError) return json({ error: error.message }, error.status);
        return json({ error: STORAGE_ERROR("the subtitle") }, 400);
      } finally { pending--; }
    },
    observe(state: PlayerState) {
      if (state.status === "loading") return;
      retain();
    },
    stopped: retain,
    // The item moved to a new transport (another quality or Device); its files move with it.
    moved(from: string | null, to: string) { for (const file of files.values()) if (file.playbackId === from) file.playbackId = to; },
    async serve(address: URL) {
      const vtt = (text: string) => new Response(text, { headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "no-store" } });
      const file = files.get(address.pathname);
      if (file) return vtt(file.text);
      const url = address.searchParams.get("url") ?? "";
      const given = Buffer.from(address.pathname.slice("/api/subtitles/".length, -".vtt".length));
      const expected = Buffer.from(sign(url));
      if (!url || given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response("Not found", { status: 404 });
      const signal = AbortSignal.timeout(10_000);
      const content = await publicRequest(url, { signal, redirect: "error" }).then(async response => {
        if (!response.ok) { await response.body?.cancel(); return ""; }
        return new TextDecoder().decode(await boundedBytes(response, subtitleSizeLimit, signal));
      }).catch(() => "");
      if (content.includes("\0") || !cues.test(content)) return new Response("The source's subtitles couldn't be read.", { status: 502 });
      return vtt(webVtt(content, !/^\uFEFF?WEBVTT/.test(content)));
    },
    close() { closed = true; files.clear(); },
  };
}
