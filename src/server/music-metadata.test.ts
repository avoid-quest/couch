import { expect, test } from "bun:test";
import type { IAudioMetadata } from "music-metadata";
import { musicArtistId, normalizeMusicMetadata, readMusicMetadata } from "./music-metadata";

function metadata(common: Partial<IAudioMetadata["common"]>): IAudioMetadata {
  return { common: { track: { no: null, of: null }, disk: { no: null, of: null }, movementIndex: { no: null, of: null }, ...common }, format: { trackInfo: [], tagTypes: [] }, native: {}, quality: { warnings: [] } };
}

test("music identities normalize names and retain individual compilation artists", () => {
  const one = normalizeMusicMetadata(metadata({ album: "  COLLECTION  ", albumartist: "Band  Name", artists: ["Singer", "Guest", "singer"] }));
  const two = normalizeMusicMetadata(metadata({ album: "collection", albumartist: "band name", artist: "Different singer" }));
  expect(one.albumId).toBe(two.albumId);
  expect(one.artists).toEqual(["singer", "Guest"]);
  expect(musicArtistId("Band  Name")).toBe(musicArtistId("band name"));
  expect(normalizeMusicMetadata(metadata({ album: "Collection", compilation: true, artist: "Guest" })).albumArtist).toBe("Various Artists");
  expect(normalizeMusicMetadata(metadata({ artist: "Singer" })).albumId).toBeNull();
  expect(normalizeMusicMetadata(metadata({ track: { no: -1, of: 2 }, disk: { no: 1.5, of: 2 } }))).toMatchObject({ trackNumber: null, discNumber: null });
});

test("artwork accepts only bounded raster bytes and ignores declared image MIME for SVG", () => {
  expect(normalizeMusicMetadata(metadata({ picture: [{ format: "image/png", data: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>") }] })).artwork).toBeNull();
  const huge = Buffer.alloc(2 * 1024 * 1024 + 1); huge[0] = 255; huge[1] = 216; huge[2] = 255;
  expect(normalizeMusicMetadata(metadata({ picture: [{ format: "image/jpeg", data: huge }] })).artwork).toBeNull();
  const jpeg = Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]);
  expect(normalizeMusicMetadata(metadata({ picture: [{ format: "wrong", data: jpeg }] })).artwork?.mimeType).toBe("image/jpeg");
});

test("oversized audio metadata inputs are rejected before opening the path", async () => {
  expect(await readMusicMetadata("/not-an-audio-file", 513 * 1024 * 1024)).toBeNull();
  expect(await readMusicMetadata("/not-an-audio-file", 0)).toBeNull();
});
