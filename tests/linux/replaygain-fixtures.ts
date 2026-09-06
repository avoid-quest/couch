import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export const replayGainSampleRate = 48_000;

export async function generateReplayGainFixtures(directory: string, ffmpeg = "ffmpeg") {
  await mkdir(directory, { recursive: true });
  const duration = 8;
  const references = ["quiet", "loud"] as const;
  for (const name of references) {
    const amplitude = name === "quiet" ? 0.125 : 0.8;
    const pcm = Buffer.alloc(replayGainSampleRate * duration * 2);
    // A chirp gives each interior capture window a distinct reference position.
    for (let sample = 0; sample < pcm.length / 2; sample++) {
      const time = sample / replayGainSampleRate;
      pcm.writeInt16LE(Math.round(32767 * amplitude * Math.sin(2 * Math.PI * (317 * time + 23 * time * time))), sample * 2);
    }
    await Bun.write(join(directory, `${name}.s16le`), pcm);
  }
  async function run(args: string[]) {
    const child = Bun.spawn([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", ...args], { stdout: "ignore", stderr: "pipe" });
    const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`ReplayGain fixture generation failed: ${error}`);
  }
  await run(["-f", "lavfi", "-i", "color=c=0x32b8d9:size=96x96", "-frames:v", "1", join(directory, "cover.png")]);
  const fixtures = [
    { name: "tagged", reference: "quiet", tags: { REPLAYGAIN_TRACK_GAIN: "-6 dB", REPLAYGAIN_TRACK_PEAK: "0.125", REPLAYGAIN_ALBUM_GAIN: "-3 dB", REPLAYGAIN_ALBUM_PEAK: "0.125" }, expectedDb: { off: 0, track: -6, album: -3 } },
    { name: "boost", reference: "quiet", tags: { REPLAYGAIN_TRACK_GAIN: "+6 dB", REPLAYGAIN_TRACK_PEAK: "0.125" }, expectedDb: { off: 0, track: 6, album: 6 } },
    { name: "clipping", reference: "loud", tags: { REPLAYGAIN_TRACK_GAIN: "+12 dB", REPLAYGAIN_TRACK_PEAK: "0.8", REPLAYGAIN_ALBUM_GAIN: "+6 dB", REPLAYGAIN_ALBUM_PEAK: "0.8" }, expectedDb: { off: 0, track: 20 * Math.log10(1 / 0.8), album: 20 * Math.log10(1 / 0.8) } },
    { name: "untagged", reference: "quiet", tags: {}, expectedDb: { off: 0, track: 0, album: 0 } },
    { name: "missing-peak", reference: "loud", tags: { REPLAYGAIN_TRACK_GAIN: "+6 dB" }, expectedDb: { off: 0, track: 0, album: 0 } },
    { name: "missing-peak-attenuation", reference: "quiet", tags: { REPLAYGAIN_TRACK_GAIN: "-6 dB" }, expectedDb: { off: 0, track: 0, album: 0 }, currentMpvExpectedDb: { off: 0, track: -6, album: -6 } },
    { name: "r128-missing-peak", reference: "loud", tags: { R128_TRACK_GAIN: "256" }, expectedDb: { off: 0, track: 6, album: 6 } },
    { name: "r128-overflow", reference: "quiet", tags: { R128_TRACK_GAIN: "256000" }, expectedDb: { off: 0, track: 0, album: 0 } },
    { name: "r128-nonfinite", reference: "quiet", tags: { R128_TRACK_GAIN: "1e999" }, expectedDb: { off: 0, track: 0, album: 0 } },
    { name: "cover-art", reference: "quiet", tags: { REPLAYGAIN_TRACK_GAIN: "-6 dB", REPLAYGAIN_TRACK_PEAK: "0.125" }, expectedDb: { off: 0, track: -6, album: -6 } },
    { name: "video", reference: "quiet", tags: { REPLAYGAIN_TRACK_GAIN: "-6 dB", REPLAYGAIN_TRACK_PEAK: "0.125" }, expectedDb: { off: 0, track: 0, album: 0 } },
  ];
  const manifest = [];
  for (const fixture of fixtures) {
    const file = `${fixture.name}.${fixture.name === "video" ? "mkv" : "flac"}`;
    const inputs = ["-f", "s16le", "-ar", String(replayGainSampleRate), "-ac", "1", "-i", join(directory, `${fixture.reference}.s16le`)];
    if (fixture.name === "cover-art") inputs.push("-i", join(directory, "cover.png"));
    if (fixture.name === "video") inputs.push("-f", "lavfi", "-i", `color=blue:size=640x360:rate=24:duration=${duration}`);
    const video = fixture.name === "video" ? ["-map", "1:v", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]
      : fixture.name === "cover-art" ? ["-map", "1:v", "-c:v", "copy", "-disposition:v", "attached_pic"] : [];
    await run([...inputs, "-map", "0:a", ...video, "-c:a", "flac", "-metadata", `title=ReplayGain ${fixture.name}`, "-metadata", "artist=Couch reference", "-metadata", "album=ReplayGain references", ...Object.entries(fixture.tags).flatMap(([key, value]) => ["-metadata", `${key}=${value}`]), join(directory, file)]);
    manifest.push({ ...fixture, file, sha256: createHash("sha256").update(Buffer.from(await Bun.file(join(directory, file)).arrayBuffer())).digest("hex") });
  }
  const result = { sampleRate: replayGainSampleRate, duration, format: "mono signed 16-bit little-endian PCM", expectedRuntime: "Ubuntu 24.04 mpv 0.37", fixtures: manifest, note: "Generated inputs and predicted gains only. Missing-peak attenuation differs in current mpv. R128 without a peak can exceed full scale; captures must distinguish mixer gain from output clipping. This manifest is not captured Couch audio or physical qualification." };
  await Bun.write(join(directory, "manifest.json"), JSON.stringify(result, null, 2));
  return result;
}

if (import.meta.main) {
  if (!Bun.argv[2]) throw new Error("Provide a private output directory for ReplayGain fixtures.");
  await generateReplayGainFixtures(resolve(Bun.argv[2]), Bun.argv[3] ?? "ffmpeg");
}
