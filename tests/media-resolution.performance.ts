// bun build tests/media-resolution.performance.ts --target=node --outfile=build/media-resolution.performance.mjs
// COUCH_DATA_DIR="$PWD/.artifacts/media-resolution/data" node build/media-resolution.performance.mjs .artifacts/media-resolution [--rounds=3]
// Real external providers, helpers and protected relay. Writes timings, never signed URLs.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { startHelpers, helper } from "../src/server/helpers";
import { createWebMediaResolver } from "../src/server/web-media";
import { createPassThrough } from "../src/server/pass-through";
import { healStreamingCommunityOrigin } from "../src/server/streamingcommunity";
import { streamingCommunityOrigin } from "../src/shared/streamingcommunity";
import { safePlaybackError } from "../src/server/playback-log";

const directory = resolve(process.argv[2] ?? ".artifacts/media-resolution");
const rounds = Number(process.argv.find(arg => arg.startsWith("--rounds="))?.split("=")[1] ?? 3);
// A benchmark always owns its data, even when launched from an installed app's environment.
process.env.COUCH_DATA_DIR = join(directory, "data"); process.env.COUCH_PORT = "42789";
mkdirSync(directory, { recursive: true });
startHelpers(join(directory, "data", "helpers"));
await Promise.all([helper("yt-dlp"), helper("qjs"), helper("ffmpeg")]);
const resolver = createWebMediaResolver(), samples: object[] = [];
let scOrigin = streamingCommunityOrigin;
for (let round = 0; round < rounds; round++) for (const provider of ["youtube", "streamingcommunity"]) {
  const relay = createPassThrough(() => true), started = performance.now();
  try {
    const origin = provider === "streamingcommunity" ? await healStreamingCommunityOrigin({ streamingCommunityOrigin: () => scOrigin, saveStreamingCommunityOrigin: value => { scOrigin = value; } }, AbortSignal.timeout(30_000)) : undefined;
    const originMs = performance.now() - started;
    const source = provider === "youtube" ? "https://www.youtube.com/watch?v=YE7VzlLtp-4" : `${origin}/it/watch/66337`;
    const media = await resolver(source, AbortSignal.timeout(30_000), "auto", origin, true);
    const resolvedMs = performance.now() - started, preparing = performance.now();
    const target = { origin: await relay.coreOrigin(), userAgent: "Couch" };
    await relay.prepare("benchmark", media, media.headers ?? {}, target, AbortSignal.timeout(15_000));
    const prepared = await relay.prepare("benchmark", media, media.headers ?? {}, { ...target, userAgent: "Mozilla/5.0 Chrome/156.0.0.0" }, AbortSignal.timeout(15_000));
    const prepareMs = performance.now() - preparing, streams = [];
    for (const [kind, url] of [["video", prepared.source], ["audio", prepared.audioSource]] as const) {
      if (!url) continue;
      const at = performance.now();
      const response = await relay.serve(new Request(url, { headers: { Range: "bytes=0-65535" }, signal: AbortSignal.timeout(15_000) }));
      const reader = response.body?.getReader();
      const first = await reader?.read(); await reader?.cancel();
      const bytes = first?.value?.byteLength ?? 0;
      streams.push({ kind, status: response.status, firstBytesMs: performance.now() - at, bytes });
      if (!response.ok || !bytes) process.exitCode = 1;
    }
    samples.push({ round, provider, originMs, resolvedMs, prepareMs, hls: prepared.hls ?? false, streams });
  } catch (error) {
    samples.push({ round, provider, elapsedMs: performance.now() - started, error: safePlaybackError(error instanceof Error ? error.message : "Unknown error") }); process.exitCode = 1;
  } finally { await relay.close(); }
  console.log(JSON.stringify(samples.at(-1)));
  writeFileSync(join(directory, "result.json"), JSON.stringify({ versions: process.versions, samples }, null, 2));
}
