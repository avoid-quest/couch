import { createHash } from "node:crypto";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type { LibraryItem } from "../shared/library";
import type { MetadataMatch, MetadataValues } from "../shared/metadata";
import { parseVideoNfo } from "./video-metadata";

export class MetadataError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export const metadataHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const metadataValues = (item: LibraryItem): MetadataValues => ({ title: item.title, showTitle: item.video?.show?.title ?? null, originalTitle: item.video?.originalTitle ?? null,
  plot: item.video?.plot ?? null, year: item.video?.year ?? null, premiered: item.video?.premiered ?? null, genres: item.video?.genres ?? [],
  season: item.video?.season ?? null, episode: item.video?.episode ?? null, artworkId: item.artworkId ?? null });
export function metadataChanges(value: unknown, episode: boolean): Partial<MetadataValues> {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) throw new MetadataError("Choose a metadata correction.");
  const changes = value as Partial<MetadataValues>;
  for (const [key, value] of Object.entries(changes)) {
    if (key === "showTitle" && (episode ? value === null : value !== null)) throw new MetadataError("Episodes need a series title; movies do not have one.");
    if (["title", "originalTitle", "plot", "showTitle"].includes(key)) {
      if (value === null && key !== "title") continue;
      if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > (key === "plot" ? 4000 : 300) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new MetadataError(`Invalid ${key}.`);
    } else if (["year", "season", "episode"].includes(key)) {
      if (value !== null && (!Number.isInteger(value) || Number(value) < (key === "year" ? 1000 : 0) || Number(value) > (key === "season" ? 999 : 9999))) throw new MetadataError(`Invalid ${key}.`);
      if (key !== "year" && !episode && value !== null) throw new MetadataError("Only episodes have season and episode numbers.");
    } else if (key === "premiered") {
      if (value !== null && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new MetadataError("Use a valid release date.");
    } else if (key === "genres") {
      if (!Array.isArray(value) || value.length > 16 || value.some(v => typeof v !== "string" || !v.trim() || v !== v.trim() || v.length > 80 || /[\u0000-\u001f\u007f]/.test(v)) || new Set(value).size !== value.length) throw new MetadataError("Use up to 16 distinct genres.");
    } else if (key === "artworkId") {
      if (value !== null && (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))) throw new MetadataError("Choose valid artwork.");
    } else throw new MetadataError("Unknown metadata field.");
  }
  return changes;
}

// Only direct supported fields change. Ordered unknown elements, attributes and comments survive.
export function correctedNfo(original: Uint8Array | null, item: LibraryItem, match: MetadataMatch | null, matchChanged = match !== null): string {
  const type = item.video?.type === "episode" ? "episodedetails" : "movie";
  const options = { preserveOrder: true, ignoreAttributes: false, parseTagValue: false, commentPropName: "#comment", trimValues: false };
  type Node = { [key: string]: Node[] | string | Record<string, string> };
  let document: Node[] = [{ [type]: [] }];
  if (original) {
    if (parseVideoNfo(original).type !== type) throw new MetadataError("The imported NFO type no longer matches this item.", 409);
    document = new XMLParser(options).parse(new TextDecoder().decode(original));
  }
  const root = document.find(node => Array.isArray(node[type]))![type] as Node[];
  const values = metadataValues(item);
  const fields: Record<string, string | number | string[] | null> = { title: values.title, originaltitle: values.originalTitle, plot: values.plot,
    year: values.year, [type === "movie" ? "premiered" : "aired"]: values.premiered, genre: values.genres,
    ...(type === "episodedetails" ? { season: values.season, episode: values.episode, showtitle: item.video?.show?.title ?? null } : {}) };
  for (const [name, value] of Object.entries(fields)) {
    for (let index = root.length - 1; index >= 0; index--) if (name in root[index]!) root.splice(index, 1);
    for (const part of Array.isArray(value) ? value : value === null ? [] : [value]) root.push({ [name]: [{ "#text": String(part) }] });
  }
  if (matchChanged) {
    for (let index = root.length - 1; index >= 0; index--) if (root[index]?.uniqueid && (root[index]?.[":@"] as Record<string, string> | undefined)?.["@_type"] === "tmdb") root.splice(index, 1);
    if (match) root.push({ uniqueid: [{ "#text": String(match.id) }], ":@": { "@_type": "tmdb", "@_default": "true" } });
  }
  const xml = new XMLBuilder(options).build(document) as string;
  parseVideoNfo(new TextEncoder().encode(xml));
  return xml;
}

export function correctedShowNfo(original: Uint8Array | null, title: string): string {
  if (original && parseVideoNfo(original).type !== "tvshow") throw new MetadataError("Invalid imported show NFO.");
  const options = { preserveOrder: true, ignoreAttributes: false, parseTagValue: false, commentPropName: "#comment", trimValues: false };
  const document = new XMLParser(options).parse(original ? new TextDecoder().decode(original) : "<tvshow><title>Show</title></tvshow>") as Array<Record<string, Array<Record<string, unknown>>>>;
  const root = document.find(node => Array.isArray(node.tvshow))!.tvshow!;
  for (let index = root.length - 1; index >= 0; index--) if ("title" in root[index]!) root.splice(index, 1);
  root.push({ title: [{ "#text": title }] });
  const xml = new XMLBuilder(options).build(document) as string;
  parseVideoNfo(new TextEncoder().encode(xml));
  return xml;
}
