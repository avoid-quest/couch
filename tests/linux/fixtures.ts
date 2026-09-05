import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

await mkdir("/fixtures", { recursive: true });
await Bun.write("/fixtures/subtitles.srt", "1\n00:00:00,000 --> 00:00:20,000\nNative subtitle test\n");
await Bun.write("/fixtures/external-tv.srt", "1\n00:00:00,000 --> 00:01:00,000\n<font color=\"#ffff00\">External SRT from TV</font>\n");
await Bun.write("/fixtures/external-phone.ass", `[Script Info]
ScriptType: v4.00+
PlayResX: 640
PlayResY: 360
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,30,&H00FF00FF,&H00FF00FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,25,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:01:00.00,Default,,0,0,0,,External ASS from phone
`);
await Bun.write("/fixtures/invalid-subtitle.srt", "This is not a subtitle file.\n");
await Bun.write("/fixtures/jellyfin-italian.srt", "1\n00:00:00,000 --> 00:01:00,000\nSottotitolo esterno Jellyfin\n");
await Bun.write("/fixtures/chapters.txt", `;FFMETADATA1
title=Linux playback fixture
[CHAPTER]
TIMEBASE=1/1000
START=0
END=10000
title=First chapter
[CHAPTER]
TIMEBASE=1/1000
START=10000
END=20000
title=Second chapter
`);
const child = Bun.spawn([
  "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=20",
  "-f", "lavfi", "-i", "sine=frequency=440:duration=20",
  "-f", "lavfi", "-i", "sine=frequency=660:duration=20",
  "-i", "/fixtures/subtitles.srt", "-i", "/fixtures/chapters.txt",
  "-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:s", "-map_metadata", "4", "-map_chapters", "4",
  "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-c:s", "srt",
  "-metadata:s:a:0", "language=eng", "-metadata:s:a:0", "title=English tone",
  "-metadata:s:a:1", "language=ita", "-metadata:s:a:1", "title=Italian tone",
  "-metadata:s:s:0", "language=eng", "-t", "20", "/fixtures/multitrack.mkv",
], { stdout: "inherit", stderr: "inherit" });
if (await child.exited !== 0) throw new Error("Cannot generate media fixture");
const preference = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", "/fixtures/multitrack.mkv", "-map", "0", "-c", "copy", "-metadata", "title=Playback preference fixture", "/fixtures/preferences.mkv"], { stdout: "inherit", stderr: "inherit" });
if (await preference.exited !== 0) throw new Error("Cannot copy the preference fixture");
const radio = Bun.spawn([
  "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", "/fixtures/multitrack.mkv",
  "-map", "0:a:0", "-t", "10", "-c:a", "libmp3lame", "-map_metadata", "-1", "-map_chapters", "-1",
  "-metadata", "title=Local radio fixture", "/fixtures/radio.mp3",
], { stdout: "inherit", stderr: "inherit" });
if (await radio.exited !== 0) throw new Error("Cannot generate radio fixture");
await mkdir("/web-fixtures", { recursive: true });
const dash = Bun.spawn([
  "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", "/fixtures/multitrack.mkv",
  "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-map_metadata", "-1", "-map_chapters", "-1",
  "-f", "dash", "-seg_duration", "5", "-adaptation_sets", "id=0,streams=v id=1,streams=a", "/web-fixtures/manifest.mpd",
], { stdout: "inherit", stderr: "inherit" });
if (await dash.exited !== 0) throw new Error("Cannot generate DASH fixture");
await mkdir("/quality-fixtures", { recursive: true });
const quality = Bun.spawn([
  "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi", "-i", "sine=frequency=440:duration=20",
  "-f", "lavfi", "-i", "color=blue:size=640x360:rate=24:duration=20",
  "-f", "lavfi", "-i", "color=red:size=1280x720:rate=24:duration=20",
  "-map", "0:a", "-map", "1:v", "-map", "2:v",
  "-c:a", "aac", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
  // lavfi colors use the BT.601 matrix at both sizes; prevent HD resolution-based guessing.
  "-colorspace", "smpte170m", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
  "-b:v:0", "250k", "-b:v:1", "500k", "-g", "48",
  "-f", "dash", "-seg_duration", "2", "-adaptation_sets", "id=0,streams=a id=1,streams=v",
  "/quality-fixtures/manifest.mpd",
], { stdout: "inherit", stderr: "inherit" });
if (await quality.exited !== 0) throw new Error("Cannot generate multiresolution DASH fixture");

// Separate source root keeps the original /fixtures library search unchanged.
await mkdir("/music-fixtures/tagged", { recursive: true });
await mkdir("/music-fixtures/transitions", { recursive: true });
await mkdir("/transition-reference", { recursive: true });
async function musicFixture(args: string[]) {
  const process = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], { stdout: "inherit", stderr: "inherit" });
  if (await process.exited !== 0) throw new Error(`Cannot generate music fixture ${args.at(-1)}`);
}
await musicFixture(["-f", "lavfi", "-i", "color=c=0x32b8d9:size=96x96", "-frames:v", "1", "/transition-reference/cover.png"]);
const songs = [
  { file: "z-first.mp3", title: "Disc one first", artist: "Guest Singer", disc: 1, track: 2, codec: "libmp3lame" },
  { file: "a-last.flac", title: "Disc one last", artist: "Fixture Ensemble", disc: 1, track: 10, codec: "flac" },
  { file: "b-second-disc.m4a", title: "Disc two first", artist: "Fixture Ensemble", disc: 2, track: 1, codec: "aac" },
];
for (const song of songs) await musicFixture([
  "-f", "lavfi", "-i", "sine=frequency=523.25:sample_rate=44100:duration=15", "-i", "/transition-reference/cover.png",
  "-map", "0:a", "-map", "1:v", "-c:a", song.codec, "-c:v", "copy", "-disposition:v", "attached_pic",
  "-metadata", `title=${song.title}`, "-metadata", `artist=${song.artist}`, "-metadata", "album_artist=Fixture Ensemble",
  "-metadata", "album=Fixture Collection", "-metadata", `disc=${song.disc}/2`, "-metadata", `track=${song.track}/10`,
  "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)", `/music-fixtures/tagged/${song.file}`,
]);

await musicFixture(["-f", "lavfi", "-i", "sine=frequency=330:sample_rate=44100:duration=5", "-c:a", "flac", "-metadata", "title=Single without album", "-metadata", "artist=Fixture Soloist", "/music-fixtures/tagged/single.flac"]);

// Deterministic, nonperiodic PCM makes dropped and repeated samples observable.
// Both lossless files are exact slices of this one reference, including its seam.
const sampleRate = 44_100;
const splitSample = sampleRate * 3;
const pcm = Buffer.alloc(splitSample * 2 * 2);
let random = 0x5a17c9e3;
const recent = [0, 0, 0, 0];
for (let sample = 0; sample < splitSample * 2; sample++) {
  random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
  recent[sample % recent.length] = (random >>> 0) / 0x1_0000_0000 * 24_000 - 12_000;
  pcm.writeInt16LE(Math.round(recent.reduce((sum, value) => sum + value, 0) / recent.length), sample * 2);
}
await Bun.write("/transition-reference/continuous.s16le", pcm);
await musicFixture(["-f", "s16le", "-ar", String(sampleRate), "-ac", "1", "-i", "/transition-reference/continuous.s16le", "/transition-reference/continuous.wav"]);
for (let part = 0; part < 2; part++) await musicFixture([
  "-f", "s16le", "-ar", String(sampleRate), "-ac", "1", "-i", "/transition-reference/continuous.s16le",
  "-af", `atrim=start_sample=${part * splitSample}:end_sample=${(part + 1) * splitSample},asetpts=PTS-STARTPTS`, "-c:a", "flac",
  "-metadata", `title=Transition part ${part + 1}`, "-metadata", "artist=Fixture Ensemble", "-metadata", "album_artist=Fixture Ensemble",
  "-metadata", "album=Transition measurement", "-metadata", `track=${part + 1}/2`, `/music-fixtures/transitions/part-${part + 1}.flac`,
]);
const hashes = [];
for (const path of ["/transition-reference/continuous.wav", "/transition-reference/continuous.s16le", "/music-fixtures/transitions/part-1.flac", "/music-fixtures/transitions/part-2.flac", "/music-fixtures/tagged/single.flac", ...songs.map(song => `/music-fixtures/tagged/${song.file}`)]) {
  hashes.push({ path, sha256: createHash("sha256").update(Buffer.from(await Bun.file(path).arrayBuffer())).digest("hex") });
}
await Bun.write("/transition-reference/manifest.json", JSON.stringify({ sampleRate, splitSample, samples: splitSample * 2, format: "mono s16le", hashes }, null, 2));
