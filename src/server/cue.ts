import { FileType, parse, TrackDataType } from "@gplane/cue";
import { parseStream } from "music-metadata";
import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { normalizeMusicMetadata, type MusicMetadata } from "./music-metadata";

export const cueLimits = { bytes: 256 * 1024, lines: 2048, lineLength: 2048, tracks: 99 } as const;
const commands = new Set("REM CATALOG TITLE PERFORMER SONGWRITER FILE TRACK INDEX ISRC FLAGS PREGAP POSTGAP CDTEXTFILE".split(" "));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const label = (value: string | undefined) => value?.replace(/[\r\n\t]/g, " ").trim().slice(0, 300) || null;

export type CueTrack = { id: string; title: string; artist: string | null; trackNumber: number; start: number; end: number; duration: number };
export type CueAlbum = {
  id: string; title: string; artist: string | null; cuePath: string; sourcePath: string;
  music: MusicMetadata; tracks: CueTrack[];
};

export function parseCueSheet(text: string) {
  if (Buffer.byteLength(text) > cueLimits.bytes) throw new Error("Cue sheet exceeds 256 KiB.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|\r(?!\n)/.test(text)) throw new Error("Cue sheet contains unsupported control characters.");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length > cueLimits.lines || lines.some(line => line.length > cueLimits.lineLength)) throw new Error("Cue sheet exceeds its line limits.");
  let tracks = 0;
  // The parser tolerates unknown commands and parseInt suffixes. Reject those
  // outside our subset before calling it; grammar and AST construction stay upstream.
  for (const line of lines) {
    const words = line.trim().split(/\s+/, 2);
    const command = words[0]!.toUpperCase();
    if (!command) continue;
    if (!commands.has(command)) throw new Error(`Unsupported cue command: ${command.slice(0, 40)}.`);
    if (["TRACK", "INDEX"].includes(command) && !/^\d{2}$/.test(words[1] ?? "")) throw new Error("Cue TRACK and INDEX numbers must have two digits.");
    if (command === "TRACK" && ++tracks > cueLimits.tracks) throw new Error("Cue sheets support at most 99 tracks.");
  }
  const { sheet } = parse(text, { fatal: true, checkAtLeastOneTrack: true });
  if (sheet.files.length !== 1) throw new Error("Cue sheets with multiple FILE commands are not supported.");
  if (sheet.CDTextFile !== undefined) throw new Error("Cue CDTEXTFILE references are not supported.");
  const file = sheet.files[0]!;
  if (file.type !== FileType.Wave || ![".flac", ".wav"].includes(extname(file.name).toLowerCase())) throw new Error("Cue sheets support one FLAC or WAV file declared as WAVE.");
  if (!file.tracks.length || file.tracks.length > cueLimits.tracks || file.tracks.length !== tracks) throw new Error("Every cue track must belong to the one FILE command.");
  let previous = -1;
  const items = file.tracks.map((track, index) => {
    if (track.dataType !== TrackDataType.Audio || track.trackNumber !== index + 1) throw new Error("Cue sheets require consecutive AUDIO tracks starting at 01.");
    if (track.flags || track.preGap || track.postGap || track.indexes.length !== 1 || track.indexes[0]?.number !== 1) throw new Error("Cue flags, gaps, INDEX 00 and extra indexes are not supported. Use one INDEX 01 per track.");
    const [minutes, seconds, frames] = track.indexes[0].startingTime;
    const startFrame = (minutes * 60 + seconds) * 75 + frames;
    if (![minutes, seconds, frames, startFrame].every(Number.isSafeInteger) || minutes < 0 || seconds < 0 || seconds > 59 || frames < 0 || frames > 74 || startFrame <= previous || index === 0 && startFrame !== 0) throw new Error("Cue indexes must start at zero and increase in valid 75-frame times.");
    previous = startFrame;
    return { trackNumber: track.trackNumber, title: label(track.title), artist: label(track.performer), startFrame };
  });
  return { reference: file.name, title: label(sheet.title), artist: label(sheet.performer), tracks: items };
}

function within(root: string, path: string) {
  const local = relative(root, path);
  return local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local);
}

const sameFile = (left: Stats, right: Stats) => left.dev === right.dev && left.ino === right.ino;

async function checkFile(root: string, rootInfo: Stats, path: string, info: Stats) {
  if (!sameFile(rootInfo, await lstat(root)) || await realpath(root) !== root || !within(root, path) || await realpath(path) !== path) throw new Error("Cue source or file changed, is outside the source, or uses symbolic links.");
  const current = await lstat(path);
  if (!current.isFile() || !sameFile(current, info) || current.size !== info.size || current.mtimeMs !== info.mtimeMs || current.ctimeMs !== info.ctimeMs) throw new Error("Cue file changed while reading.");
}

async function openFile(root: string, rootInfo: Stats, path: string, maxBytes: number) {
  if (!within(root, path)) throw new Error("Cue files must stay inside the library source.");
  const before = await lstat(path);
  await checkFile(root, rootInfo, path, before);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || !sameFile(before, info)) throw new Error("Cue file changed while opening.");
    await checkFile(root, rootInfo, path, info);
    if (info.size > maxBytes) throw new Error(maxBytes === cueLimits.bytes ? "Cue sheet exceeds 256 KiB." : "Cue audio files must be nonempty and at most 512 MiB.");
    return { file, info };
  } catch (error) { await file.close(); throw error; }
}

async function readSheet(file: FileHandle) {
  const buffer = Buffer.alloc(cueLimits.bytes + 1);
  let length = 0;
  while (length < buffer.length) {
    const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
    if (!bytesRead) break;
    length += bytesRead;
  }
  if (length > cueLimits.bytes) throw new Error("Cue sheet exceeds 256 KiB.");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)); }
  catch { throw new Error("Cue sheets must use UTF-8 text."); }
}

export async function readCueAlbum(root: string, cuePath: string, sourceId: string): Promise<CueAlbum> {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || await realpath(root) !== root) throw new Error("The cue library source is unavailable.");
  const path = resolve(root, cuePath);
  const openedSheet = await openFile(root, rootInfo, path, cueLimits.bytes);
  let sheet: ReturnType<typeof parseCueSheet>;
  try {
    sheet = parseCueSheet(await readSheet(openedSheet.file));
    await checkFile(root, rootInfo, path, openedSheet.info);
  } finally { await openedSheet.file.close(); }
  if (!sheet.reference || /[\u0000-\u001f\u007f\\:]/.test(sheet.reference) || isAbsolute(sheet.reference)) throw new Error("Cue FILE must be a relative local filename.");
  const source = resolve(dirname(path), sheet.reference);
  const audio = await openFile(root, rootInfo, source, 512 * 1024 * 1024).catch(() => { throw new Error("The cue audio file is missing, changed, outside the source, oversized, or uses a symbolic link."); });
  let metadata;
  try {
    if (audio.info.size <= 0) throw new Error("Cue audio files must be nonempty and at most 512 MiB.");
    // The parser receives the validated descriptor, capped at its observed size.
    // It never reopens a pathname that can be replaced between check and read.
    const stream = audio.file.createReadStream({ autoClose: false, start: 0, end: audio.info.size - 1 });
    try { metadata = await parseStream(stream, { size: audio.info.size, path: source }, { duration: false, skipCovers: audio.info.size > 64 * 1024 * 1024 }); }
    catch { metadata = null; }
    finally { stream.destroy(); }
    await checkFile(root, rootInfo, source, audio.info);
    await checkFile(root, rootInfo, path, openedSheet.info);
  } finally { await audio.file.close(); }
  if (!metadata || !["FLAC", "WAVE"].includes(metadata.format.container ?? "") || metadata.format.lossless !== true) throw new Error("Cue audio must contain lossless FLAC or WAV data.");
  const music = normalizeMusicMetadata(metadata);
  if (music.duration === null || !Number.isFinite(music.duration) || music.duration <= 0) throw new Error("Could not read the cue audio duration.");
  const localPath = relative(root, path);
  const artist = sheet.artist ?? music.albumArtist ?? music.artist;
  return {
    id: hash(["cue-album", sourceId, localPath]), title: sheet.title ?? music.album ?? basename(path, extname(path)), artist,
    cuePath: localPath, sourcePath: relative(root, source), music,
    tracks: sheet.tracks.map((track, index) => {
      const start = track.startFrame / 75;
      const next = sheet.tracks[index + 1];
      const end = next ? next.startFrame / 75 : music.duration!;
      if (start >= music.duration! || end > music.duration! || end <= start) throw new Error("Cue track boundaries exceed the audio file duration.");
      return { id: hash(["cue-track", sourceId, localPath, track.trackNumber]), title: track.title ?? `Track ${String(track.trackNumber).padStart(2, "0")}`, artist: track.artist ?? artist, trackNumber: track.trackNumber, start, end, duration: end - start };
    }),
  };
}
