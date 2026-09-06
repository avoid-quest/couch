import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cueLimits, parseCueSheet, readCueAlbum } from "./cue";

const fixtures = new URL("../../tests/fixtures/cue/", import.meta.url).pathname;
const sheet = await Bun.file(join(fixtures, "album.cue")).text();
let directory: string;
let root: string;

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "couch-cue-")));
  root = join(directory, "library");
  await mkdir(root);
  await Promise.all([copyFile(join(fixtures, "album.flac"), join(root, "album.flac")), writeFile(join(root, "album.cue"), sheet)]);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

test("the maintained parser preserves titles, order and 75-frame timestamps", () => {
  expect(parseCueSheet(sheet)).toEqual({ reference: "album.flac", title: "Three tones", artist: "Couch fixture", tracks: [
    { trackNumber: 1, title: "First tone", artist: null, startFrame: 0 },
    { trackNumber: 2, title: "Second tone", artist: null, startFrame: 400 },
    { trackNumber: 3, title: "Final tone", artist: null, startFrame: 875 },
  ] });
  expect(parseCueSheet(`\uFEFF${sheet.replaceAll("\n", "\r\n")}`)).toEqual(parseCueSheet(sheet));
});

test("a real lossless album ends its final segment at measured EOF", async () => {
  const album = await readCueAlbum(root, "album.cue", "source-1");
  expect(album).toMatchObject({ title: "Three tones", artist: "Couch fixture", cuePath: "album.cue", sourcePath: "album.flac", music: { duration: 18 } });
  expect(album.tracks.map(track => [track.trackNumber, track.start, track.end])).toEqual([[1, 0, 400 / 75], [2, 400 / 75, 875 / 75], [3, 875 / 75, 18]]);
  expect(album.tracks.reduce((sum, track) => sum + track.duration, 0)).toBe(18);
  expect(new Set(album.tracks.map(track => track.id)).size).toBe(3);
  expect(album.tracks.every(track => /^[a-f0-9]{64}$/.test(track.id))).toBe(true);
});

test("one PCM WAV track uses the measured fractional final boundary", async () => {
  await copyFile(join(fixtures, "short.wav"), join(root, "short.wav"));
  await writeFile(join(root, "short.cue"), 'FILE "short.wav" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n');
  const album = await readCueAlbum(root, "short.cue", "source-1");
  expect(album.tracks).toHaveLength(1);
  expect(album.tracks[0]).toMatchObject({ title: "Track 01", start: 0, end: 0.2, duration: 0.2 });
});

test("cue identities survive metadata, reference and timestamp edits and source reappearance", async () => {
  const original = await readCueAlbum(root, "album.cue", "source-1");
  await rename(join(root, "album.flac"), join(root, "renamed.flac"));
  await writeFile(join(root, "album.cue"), sheet.replace("Three tones", "Retitled album").replace("First tone", "Retitled track").replace("album.flac", "renamed.flac").replace("00:05:25", "00:05:30"));
  const changed = await readCueAlbum(root, "album.cue", "source-1");
  expect(changed.id).toBe(original.id);
  expect(changed.tracks.map(track => track.id)).toEqual(original.tracks.map(track => track.id));
  expect(changed.tracks[1]!.start).not.toBe(original.tracks[1]!.start);
  await rename(join(root, "renamed.flac"), join(directory, "offline.flac"));
  await expect(readCueAlbum(root, "album.cue", "source-1")).rejects.toThrow("missing");
  await rename(join(directory, "offline.flac"), join(root, "renamed.flac"));
  expect((await readCueAlbum(root, "album.cue", "source-1")).tracks.map(track => track.id)).toEqual(original.tracks.map(track => track.id));
  expect((await readCueAlbum(root, "album.cue", "source-2")).tracks[0]!.id).not.toBe(original.tracks[0]!.id);
  await copyFile(join(root, "album.cue"), join(root, "copy.cue"));
  expect((await readCueAlbum(root, "copy.cue", "source-1")).tracks[0]!.id).not.toBe(original.tracks[0]!.id);
});

test("missing cue titles use numbered tracks and audio album metadata", async () => {
  await writeFile(join(root, "album.cue"), sheet.split("\n").filter(line => !line.trimStart().startsWith("TITLE ")).join("\n"));
  const album = await readCueAlbum(root, "album.cue", "source-1");
  expect(album.title).toBe("Three tones");
  expect(album.tracks.map(track => track.title)).toEqual(["Track 01", "Track 02", "Track 03"]);
});

test("the corpus rejects malformed frames, missing files and unsupported multi-file/index variants", async () => {
  for (const [name, error] of [["malformed", "Frames"], ["missing", "missing"], ["multi-file", "multiple FILE"], ["index-gap", "INDEX 00"]]) {
    await copyFile(join(fixtures, `${name}.cue`), join(root, "case.cue"));
    await expect(readCueAlbum(root, "case.cue", "source-1")).rejects.toThrow(error!);
  }
});

test("subset validation rejects inputs that the tolerant parser could otherwise normalize", () => {
  for (const invalid of [
    sheet.replace("TRACK 01", "TRACK 01suffix"), sheet.replace("INDEX 01", "INDEX 01suffix"),
    sheet.replace("TRACK 01", "TRACK 00"), sheet.replace("TRACK 02", "TRACK 01"),
    sheet.replace("TRACK 01 AUDIO", "TRACK 01 MODE1/2352"), sheet.replace("WAVE", "MP3"),
    sheet.replace("00:11:50", "00:05:25"), sheet.replace("00:11:50", "00:04:00"),
    sheet.replace("    INDEX 01 00:05:25\n", ""), sheet.replace("INDEX 01 00:00:00", "INDEX 01 00:00:01"),
    sheet.replace("INDEX 01 00:05:25", "INDEX 01 00:05:25\n    INDEX 02 00:06:00"),
    sheet.replace("INDEX 01 00:00:00", "PREGAP 00:00:00\n    INDEX 01 00:00:00"),
    sheet.replace("INDEX 01 00:00:00", "INDEX 01 00:00:00\n    POSTGAP 00:00:00"),
    sheet.replace("INDEX 01 00:00:00", "FLAGS PRE\n    INDEX 01 00:00:00"),
    `CDTEXTFILE "tags.bin"\n${sheet}`, `UNSUPPORTED\n${sheet}`, sheet.replace('"First tone"', '"Unclosed tone'),
    `${sheet}FILE "album.flac" WAVE\n`,
    sheet.replace("TRACK 01", "TRACK NaN"), sheet.replace("00:11:50", "999999999999999999999:00:00"),
  ]) expect(() => parseCueSheet(invalid)).toThrow();
});

test("byte, line, line-length and track limits reject before parser work", () => {
  expect(() => parseCueSheet("x".repeat(cueLimits.bytes + 1))).toThrow("256 KiB");
  expect(() => parseCueSheet("\n".repeat(cueLimits.lines + 1))).toThrow("line limits");
  expect(() => parseCueSheet(`REM ${"x".repeat(cueLimits.lineLength)}`)).toThrow("line limits");
  expect(() => parseCueSheet("TRACK 01 AUDIO\n".repeat(cueLimits.tracks + 1))).toThrow("99 tracks");
  expect(() => parseCueSheet(`${sheet}\0`)).toThrow("control characters");
  expect(() => parseCueSheet(sheet.replaceAll("\n", "\r"))).toThrow("control characters");
});

test("file reading rejects oversized and non-UTF-8 sheets", async () => {
  await writeFile(join(root, "album.cue"), Buffer.alloc(cueLimits.bytes + 1));
  await expect(readCueAlbum(root, "album.cue", "source-1")).rejects.toThrow("256 KiB");
  await writeFile(join(root, "album.cue"), Buffer.from([0xff, 0xfe, 0x54, 0x00]));
  await expect(readCueAlbum(root, "album.cue", "source-1")).rejects.toThrow("UTF-8");
});

test("references cannot open URLs, absolute paths, sibling escapes or symbolic links", async () => {
  await copyFile(join(root, "album.flac"), join(directory, "outside.flac"));
  await symlink(join(directory, "outside.flac"), join(root, "linked.flac"));
  await symlink(directory, join(root, "linked-directory"));
  for (const reference of ["https://example.com/audio.flac", "file:///tmp/audio.flac", join(directory, "outside.flac"), "../outside.flac", "linked.flac", "linked-directory/outside.flac", "C:\\audio.flac", "//host/audio.flac"]) {
    await writeFile(join(root, "album.cue"), sheet.replace("album.flac", reference));
    await expect(readCueAlbum(root, "album.cue", "source-1")).rejects.toThrow();
  }
  await writeFile(join(directory, "outside.cue"), sheet);
  await symlink(join(directory, "outside.cue"), join(root, "linked.cue"));
  await expect(readCueAlbum(root, "linked.cue", "source-1")).rejects.toThrow("symbolic");
  await expect(readCueAlbum(root, "../outside.cue", "source-1")).rejects.toThrow("inside");
});

test("relative parent references are allowed when they remain inside the source", async () => {
  await mkdir(join(root, "sheets"));
  await writeFile(join(root, "sheets", "album.cue"), sheet.replace("album.flac", "../album.flac"));
  expect((await readCueAlbum(root, "sheets/album.cue", "source-1")).sourcePath).toBe("album.flac");
});

test("unknown duration and zero-length or out-of-file final segments fail the entire album", async () => {
  for (const time of ["00:18:00", "00:19:00"]) {
    await writeFile(join(root, "album.cue"), sheet.replace("00:11:50", time));
    await expect(readCueAlbum(root, "album.cue", "source-1")).rejects.toThrow("boundaries");
  }
  await writeFile(join(root, "album.cue"), sheet);
  await writeFile(join(root, "album.flac"), "not audio");
  await expect(readCueAlbum(root, "album.cue", "source-1")).rejects.toThrow("lossless");
});
