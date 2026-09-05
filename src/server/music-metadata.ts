import { createHash } from "node:crypto";
import { parseFile, type IAudioMetadata, type IPicture } from "music-metadata";

export const musicMetadataVersion = 2;
const maxMetadataFileBytes = 512 * 1024 * 1024;
const maxCoverFileBytes = 64 * 1024 * 1024;
const maxArtworkBytes = 2 * 1024 * 1024;

export type MusicMetadata = {
  title: string | null; duration: number | null; artist: string | null; artists: string[];
  album: string | null; albumArtist: string | null; albumId: string | null;
  discNumber: number | null; trackNumber: number | null;
  artwork: { id: string; data: Uint8Array; mimeType: string } | null;
};

const tag = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
const normalized = (value: string) => value.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const musicArtistId = (name: string) => hash(normalized(name));
const number = (value: number | null | undefined) => Number.isInteger(value) && value! > 0 && value! <= 100_000 ? value! : null;

function artwork(pictures: IPicture[] | undefined): MusicMetadata["artwork"] {
  const candidates = (pictures ?? []).slice(0, 16).sort((a, b) => Number(b.type === "Cover (front)") - Number(a.type === "Cover (front)"));
  for (const picture of candidates) {
    const data = picture.data;
    if (!data.length || data.length > maxArtworkBytes) continue;
    const prefix = Buffer.from(data.subarray(0, 12));
    const mimeType = prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
      : prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255 ? "image/jpeg"
      : prefix.toString("ascii", 0, 4) === "RIFF" && prefix.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
    if (mimeType) return { id: hash(data), data, mimeType };
  }
  return null;
}

export function normalizeMusicMetadata(metadata: IAudioMetadata): MusicMetadata {
  const common = metadata.common;
  const artists = [...new Map((common.artists?.length ? common.artists : [common.artist]).slice(0, 32)
    .map(tag).filter((value): value is string => !!value).map(name => [normalized(name), name])).values()];
  const album = tag(common.album);
  const albumArtist = tag(common.albumartist) ?? (common.compilation ? "Various Artists" : artists[0] ?? null);
  const duration = metadata.format.duration;
  return {
    title: tag(common.title)?.slice(0, 300) ?? null, duration: typeof duration === "number" && Number.isFinite(duration) && duration >= 0 ? duration : null,
    artist: tag(common.artist) ?? (artists.length ? artists.join(", ") : null), artists, album, albumArtist,
    albumId: album ? hash(JSON.stringify([normalized(album), normalized(albumArtist ?? "")])) : null,
    discNumber: number(common.disk?.no), trackNumber: number(common.track?.no), artwork: artwork(common.picture),
  };
}

export async function readMusicMetadata(path: string, size: number): Promise<MusicMetadata | null> {
  // Check before parsing. Two callers at most are owned and awaited by the scan queue.
  // parseFile has no abort API; do not race it against a timer and orphan filesystem work.
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxMetadataFileBytes) return null;
  try {
    const metadata = await parseFile(path, { duration: false, skipCovers: size > maxCoverFileBytes });
    return metadata.format.container ? normalizeMusicMetadata(metadata) : null;
  } catch {
    return null;
  }
}
