import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useHelper } from "./helpers";
import { serve, type Listener } from "./http";

type Repack = {
  token: string;
  directory?: string;
  child?: ChildProcess;
  ready?: Promise<string>;
  exited?: Promise<void>;
  stopped: boolean;
};

// How often a repack whose group ended is noticed and stopped.
const sweepMs = 5_000;

// A raw MPEG-TS channel on a group's screens: mpegts.js can't map its timestamps to the group's
// clock, so Core repackages the channel once into an HLS playlist, copying its packets (no
// re-encode). Core's sound and every screen read that one playlist through the relay, so hls.js
// maps it like any endless stream. It is served only on loopback, without CORS, so the relay
// probe always relays it to Devices. `wanted` says whether a load still plays in a group.
export function createRepacks(wanted: (playbackId: string) => boolean) {
  const repacks = new Map<string, Repack>();
  let listener: Promise<Listener> | undefined;
  let closed = false;

  const stop = (playbackId: string) => {
    const repack = repacks.get(playbackId);
    if (!repack) return;
    repacks.delete(playbackId);
    repack.stopped = true;
    repack.child?.kill("SIGKILL");
  };
  const sweep = setInterval(() => {
    for (const playbackId of repacks.keys()) if (!wanted(playbackId)) stop(playbackId);
  }, sweepMs);
  sweep.unref();

  const respond = async (request: Request) => {
    const [token = "", file = ""] = new URL(request.url).pathname.split("/").slice(1);
    const repack = [...repacks.values()].find((item) => item.token === token);
    if (!repack?.directory || !/^(?:stream\.m3u8|segment-\d{9,}\.ts)$/.test(file))
      return new Response(null, { status: 404 });
    const body = await readFile(join(repack.directory, file)).catch(() => null);
    if (!body) return new Response(null, { status: 404 });
    return new Response(body, {
      headers: {
        "Content-Type": file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t",
        "Cache-Control": "no-store",
      },
    });
  };
  const origin = async () => {
    listener ??= serve({
      hostname: "127.0.0.1",
      port: 0,
      maxRequestBodySize: 0,
      fetch: (request) =>
        request.method === "GET"
          ? respond(request)
          : Promise.resolve(new Response(null, { status: 405 })),
      websocket: { maxPayload: 0, open() {}, message() {}, close() {} },
    });
    return `http://127.0.0.1:${(await listener).port}`;
  };

  const run = async (repack: Repack, source: string) => {
    const ffmpeg = await useHelper("ffmpeg");
    const directory = await mkdtemp(join(tmpdir(), "couch-ts-repack-")).catch((error) => {
      ffmpeg.release();
      throw error;
    });
    if (repack.stopped) {
      ffmpeg.release();
      await rm(directory, { recursive: true, force: true });
      throw new Error("This channel stopped.");
    }
    repack.directory = directory;
    const child = (repack.child = spawn(
      ffmpeg.path,
      [
        "-hide_banner",
        "-nostdin",
        "-nostats",
        "-loglevel",
        "error",
        "-protocol_whitelist",
        "http,https,tcp,tls",
        "-i",
        source,
        // Picture and every sound track, so Core's sound keeps the chosen language; a
        // broadcast's subtitle, teletext and data streams aren't something hls.js plays.
        "-map",
        "0:v?",
        "-map",
        "0:a?",
        "-c",
        "copy",
        "-f",
        "hls",
        // FFmpeg's own segment length and playlist size; an endless channel drops old segments.
        "-hls_flags",
        "delete_segments",
        "-hls_segment_filename",
        "segment-%09d.ts",
        "stream.m3u8",
      ],
      { cwd: directory, stdio: "ignore" },
    ));
    child.once("error", () => {});
    repack.exited = new Promise<void>((resolve) => child.once("close", () => resolve())).then(
      async () => {
        ffmpeg.release();
        // A channel that ends or drops is read afresh by the next load.
        for (const [playbackId, item] of repacks) if (item === repack) repacks.delete(playbackId);
        repack.stopped = true;
        await rm(directory, { recursive: true, force: true });
      },
    );
    // Readable once its first segment is listed (checked as often as live-stream.ts checks its
    // own); the caller's signal bounds the wait.
    while (!repack.stopped) {
      const playlist = await readFile(join(directory, "stream.m3u8"), "utf8").catch(() => "");
      if (playlist.includes("#EXTINF:")) return `${await origin()}/${repack.token}/stream.m3u8`;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Couch couldn't repackage this channel.");
  };

  return {
    // The playlist of this load's channel, started once and shared by every caller.
    async playlist(playbackId: string, source: string, signal: AbortSignal) {
      if (closed) throw new Error("Couch is closing.");
      let ready = repacks.get(playbackId)?.ready;
      if (!ready) {
        const repack: Repack = { token: randomBytes(16).toString("hex"), stopped: false };
        repacks.set(playbackId, repack);
        ready = repack.ready = run(repack, source);
        ready.catch(() => {
          if (repacks.get(playbackId) === repack) stop(playbackId);
        });
      }
      return await Promise.race([
        ready,
        new Promise<never>((_, reject) => {
          signal.throwIfAborted();
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      ]);
    },
    async close() {
      closed = true;
      clearInterval(sweep);
      const exits = [...repacks.values()].map((repack) => repack.exited);
      for (const playbackId of [...repacks.keys()]) stop(playbackId);
      await Promise.all([...exits, (await listener)?.stop()]);
    },
  };
}
