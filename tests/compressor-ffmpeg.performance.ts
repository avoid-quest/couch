// COUCH_TEST_FFMPEG=/path/to/ffmpeg bun tests/compressor-ffmpeg.performance.ts .artifacts/compressor-ffmpeg
// Offline throughput, CPU seconds per minute of media; excludes Core/network/receivers and physical latency.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, release } from "node:os";
import { join, resolve } from "node:path";
import { compressorFilter, defaultCompressor } from "../src/shared/compressor";
const directory = resolve(process.argv[2] ?? ".artifacts/compressor-ffmpeg"), ffmpeg = process.env.COUCH_TEST_FFMPEG ?? "ffmpeg";
mkdirSync(directory, { recursive: true });
const source = join(directory, "tone.wav");
execFileSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "aevalsrc=0.8*sin(2*PI*997*t)|0.4*sin(2*PI*997*t):s=48000", "-t", "10", source]);
const duration = 300, runs = [];
for (let round = 0; round < 3; round++) for (const mode of round % 2 ? ["stress", "enabled", "off"] : ["off", "enabled", "stress"]) {
  const settings = mode === "stress" ? { ...defaultCompressor, threshold: -60, ratio: 20, attack: .1, release: 1, knee: 18, gain: 12 } : defaultCompressor;
  const graph = `[0:a:0]aresample=48000,aformat=channel_layouts=stereo,${compressorFilter(settings)},asplit=2[opus][pcm]`;
  const args = ["-hide_banner", "-nostdin", "-benchmark", "-stream_loop", "-1", "-i", source,
    ...mode === "off" ? [] : ["-filter_complex", graph],
    "-map", mode === "off" ? "0:a:0" : "[opus]", "-t", String(duration), "-ar", "48000", "-ac", "2", "-c:a", "libopus", "-b:a", "96k", "-frame_duration", "60", "-f", "null", "-",
    "-map", mode === "off" ? "0:a:0" : "[pcm]", "-t", String(duration), "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", "-f", "null", "-"];
  const started = performance.now(), result = spawnSync(ffmpeg, args, { encoding: "utf8", timeout: 60_000 });
  writeFileSync(join(directory, `${round}-${mode}.log`), result.stderr ?? "");
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  const match = /utime=([\d.]+)s stime=([\d.]+)s rtime=([\d.]+)s/.exec(result.stderr)!, memory = /maxrss=(\d+)KiB/.exec(result.stderr);
  if (!match) throw new Error("FFmpeg did not emit benchmark counters");
  runs.push({ round, mode, args, wallMs: performance.now() - started, userSeconds: Number(match[1]), systemSeconds: Number(match[2]), realSeconds: Number(match[3]), cpuSecondsPerMediaMinute: (Number(match[1]) + Number(match[2])) / (duration / 60), maxRssKiB: memory ? Number(memory[1]) : null });
}
const result = { ffmpeg: execFileSync(ffmpeg, ["-version"], { encoding: "utf8" }).split("\n")[0], cpu: cpus()[0]?.model, os: release(), mediaSeconds: duration, fixture: "48 kHz stereo PCM16 WAV → shared filter → Opus 96k/60ms + PCM; null muxers; offline throughput", runs };
writeFileSync(join(directory, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(runs.map(({ mode, cpuSecondsPerMediaMinute, maxRssKiB }) => ({ mode, cpuSecondsPerMediaMinute, maxRssKiB }))));
