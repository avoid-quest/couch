import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { imageDimensionsFromData } from "image-dimensions";
import type { VideoDescription, VideoMetadata } from "../shared/library";

export const videoExtensions = new Set("mp4 mkv webm avi mov m4v ts m2ts mts mpg mpeg ogv flv wmv vob 3gp".split(" "));
export const videoMetadataVersion = 1;
const maxNfoBytes = 256 * 1024;
const maxArtworkBytes = 2 * 1024 * 1024;
export type VideoArtwork = { id: string; data: Uint8Array; mimeType: string };
export type OriginalVideoNfo = { path: string; data: Uint8Array };
type Nfo = { type: "movie" | "episodedetails" | "tvshow"; fields: Record<string, unknown> };
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const text = (value: unknown, max = 300) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
const integer = (value: unknown, min = 0, max = 100_000) => typeof value === "string" && /^\d{1,6}$/.test(value) && Number(value) >= min && Number(value) <= max ? Number(value) : null;
const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : null;

function within(root: string, path: string) {
  const local = relative(root, path);
  return local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local);
}

async function readBounded(root: string, path: string, maximum: number): Promise<Uint8Array | null> {
  if (!within(root, path)) throw new Error("Sidecar is outside the library folder.");
  let info;
  try { info = await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || !info.size || info.size > maximum || await realpath(path) !== path) throw new Error("Invalid sidecar file.");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || await realpath(path) !== path) throw new Error("Sidecar changed during scan.");
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (!length || length > maximum) throw new Error("Sidecar exceeds the size limit.");
    return buffer.subarray(0, length);
  } finally { await file.close(); }
}

export function parseVideoNfo(bytes: Uint8Array): Nfo {
  if (!bytes.length || bytes.length > maxNfoBytes) throw new Error("NFO exceeds the size limit.");
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/\0|<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Invalid NFO XML.");
  let nodes = 0;
  const parser = new XMLParser({
    parseTagValue: false, ignoreAttributes: true, ignoreDeclaration: true, ignorePiTags: true, maxNestedTags: 32, htmlEntities: true,
    processEntities: { enabled: true, maxTotalExpansions: 10_000, maxExpandedLength: maxNfoBytes, maxEntityCount: 5 },
    updateTag: name => { if (++nodes > 4096) throw new Error("NFO exceeds the element limit."); return name; },
  });
  const parsed: Record<string, unknown> = parser.parse(xml);
  const roots = Object.keys(parsed);
  const type = roots[0];
  if (roots.length !== 1 || !["movie", "episodedetails", "tvshow"].includes(type!)) throw new Error("Unsupported NFO root.");
  const fields = parsed[type!];
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("NFO must describe one item.");
  return { type: type as Nfo["type"], fields: fields as Record<string, unknown> };
}

function description(fields: Record<string, unknown>, episode = false): VideoDescription {
  const premiered = date(episode ? fields.aired : fields.premiered);
  const genres = (Array.isArray(fields.genre) ? fields.genre : [fields.genre]).slice(0, 16).map(value => text(value, 80)).filter((value): value is string => !!value);
  return { originalTitle: text(fields.originaltitle), plot: text(fields.plot, 4000), premiered,
    year: premiered ? Number(premiered.slice(0, 4)) : integer(fields.year, 1000, 9999), genres: [...new Set(genres)] };
}

export function videoArtwork(data: Uint8Array): VideoArtwork | null {
  if (!data.length || data.length > maxArtworkBytes) return null;
  try {
    const image = imageDimensionsFromData(Uint8Array.from(data));
    if (!image || !["png", "jpeg"].includes(image.type) || !image.width || !image.height || image.width > 4096 || image.height > 4096 || image.width * image.height > 12_000_000) return null;
    // Animation is outside this subset. A frame count must not multiply the pixel bound.
    if (image.type === "png" && Buffer.from(data).includes(Buffer.from("acTL"))) return null;
    return { id: hash(data), data, mimeType: `image/${image.type}` };
  } catch { return null; }
}

export async function readVideoMetadata(root: string, sourceId: string, path: string, retainedNfo: (path: string) => Uint8Array | null = () => null) {
  let failures = 0;
  let nfoFailures = 0;
  const artworks: VideoArtwork[] = [];
  const originals: OriginalVideoNfo[] = [];
  const nfo = async (candidate: string, show = false): Promise<Nfo | null> => {
    const local = relative(root, candidate);
    const accept = (bytes: Uint8Array) => {
      const parsed = parseVideoNfo(bytes);
      if (show ? parsed.type !== "tvshow" : parsed.type === "tvshow") throw new Error("Unexpected NFO root.");
      originals.push({ path: local, data: bytes });
      return parsed;
    };
    try {
      const bytes = await readBounded(root, candidate, maxNfoBytes);
      return bytes ? accept(bytes) : null;
    } catch {
      failures++; nfoFailures++;
      const previous = retainedNfo(local);
      try { return previous ? accept(previous) : null; } catch { return null; }
    }
  };
  const art = async (directory: string, names: string[]): Promise<string | null> => {
    for (const name of names) for (const extension of ["jpg", "png", "jpeg"]) {
      try {
        const bytes = await readBounded(root, join(directory, `${name}.${extension}`), maxArtworkBytes);
        if (!bytes) continue;
        const image = videoArtwork(bytes);
        if (!image) { failures++; continue; }
        artworks.push(image);
        return image.id;
      } catch { failures++; }
    }
    return null;
  };
  const folder = dirname(path);
  const stem = basename(path, extname(path));
  const specific = await nfo(join(folder, `${stem}.nfo`));
  let item = specific;
  if (!item && await lstat(join(folder, "movie.nfo")).then(() => true, () => false)) {
    let videos = 0;
    for await (const entry of await opendir(folder)) {
      if (entry.isFile() && videoExtensions.has(extname(entry.name).slice(1).toLowerCase())) videos++;
      if (videos > 1) break;
    }
    if (videos === 1) item = await nfo(join(folder, "movie.nfo"));
  }
  const numbered = /(?:^|[ ._-])s(\d{1,3})e(\d{1,4})(?!\d)/i.exec(stem);
  const episode = item?.type === "episodedetails" || !item && !!numbered;
  const fields = item?.fields ?? {};
  const season = episode ? integer(fields.season, 0, 999) ?? (numbered ? Number(numbered[1]) : null) : null;
  const episodeNumber = episode ? integer(fields.episode, 0, 9999) ?? (numbered ? Number(numbered[2]) : null) : null;
  const showFolder = episode && /^(?:season[ ._-]*\d+|specials)$/i.test(basename(folder)) && within(root, dirname(folder)) ? dirname(folder) : folder;
  const showNfo = episode ? await nfo(join(showFolder, "tvshow.nfo"), true) : null;
  const showFields = showNfo?.type === "tvshow" ? showNfo.fields : {};
  const showTitle = text(showFields.title), episodeShowTitle = text(fields.showtitle);
  const show = episode ? {
    ...description(showFields), id: hash(JSON.stringify([sourceId, relative(root, showFolder)])),
    title: showTitle ?? episodeShowTitle ?? basename(showFolder),
    artworkId: await art(showFolder, ["poster"]), fanartId: await art(showFolder, ["fanart"]),
  } : null;
  const seasonArtworkId = show && season !== null ? await art(showFolder, [season === 0 ? "season-specials-poster" : `season${String(season).padStart(2, "0")}-poster`]) : null;
  const artworkId = await art(folder, episode ? [`${stem}-thumb`] : [`${stem}-poster`, "poster"]);
  const fanartId = episode ? show?.fanartId ?? null : await art(folder, [`${stem}-fanart`, "fanart"]);
  const video: VideoMetadata = { ...description(fields, episode), type: episode ? "episode" : "movie", show, season, episode: episodeNumber, fanartId, seasonArtworkId };
  const runtime = text(fields.runtime);
  return { title: text(fields.title), runtime: runtime && /^\d{1,5}(?:\.\d{1,2})?$/.test(runtime) && Number(runtime) > 0 && Number(runtime) <= 10_000 ? Number(runtime) * 60 : null,
    video, showTitlePriority: showTitle ? 2 : episodeShowTitle ? 1 : 0,
    artworkId: artworkId ?? show?.artworkId ?? null, artworks, originals, failures, nfoFailures };
}
