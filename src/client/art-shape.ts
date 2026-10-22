/**
 * Artwork's true shape, one per kind of item: 2:3 posters for films and series, 16:9 frames for videos and streams,
 * squares for music and stations, circles for people and channels. Tiles and rows draw it, and the Stage (Home's hero, Details); a shelf or a
 * list takes its majority shape, so its tiles line up, and an item of another shape is contained in that frame.
 */
import type { ForLaterItem } from "../shared/for-later";
import type { ProviderItem } from "../shared/providers";
import type { HistoryItem } from "../shared/viewing";
import { savedSourceLabel } from "./saved-source";

export type ArtShape = "poster" | "square" | "video" | "round";
export type ArtKind = "media" | "episode" | "collection" | "channel" | "station";

export const artAspect = { poster: "aspect-[2/3]", square: "aspect-square", video: "aspect-video", round: "aspect-square rounded-full" } as const satisfies Record<ArtShape, string>;

// The catalogues' films and series come as posters; their episodes are frames from the episode.
const catalogues = new Set(["StreamingCommunity", "123MoviesFree", "AnimeSaturn", "AnimeUnity"]);
const music = new Set(["Bandcamp", "SoundCloud"]);

/** `source` is where the item comes from as people know it (sourceLabel, a provider's name, "Radio"). */
export function artShape(source: string | undefined, kind: ArtKind = "media"): ArtShape {
  if (kind === "station" || source === "Radio") return "square";
  if (kind === "channel") return "round";
  if (music.has(source ?? "")) return "square";
  // Twitch's only lists are its categories, whose box art is a poster.
  if (source === "Twitch" && kind === "collection") return "poster";
  return catalogues.has(source ?? "") && kind !== "episode" ? "poster" : "video";
}

/** A provider's item by its kind; `source` is the provider's name. */
export const providerItemShape = (source: string, item: Pick<ProviderItem, "kind" | "collection">) =>
  artShape(source, item.kind === "channel" ? "channel" : item.kind === "collection" ? "collection" : item.collection ? "episode" : "media");
export const historyShape = (item: HistoryItem) => artShape(item.sourceLabel, item.collection ? "episode" : "media");
export const savedShape = (item: ForLaterItem) => artShape(savedSourceLabel(item), item.collection ? "episode" : "media");

/** The shape most of a shelf's or a list's items have; a tie keeps the first item's. */
export function majorityShape(shapes: readonly ArtShape[], fallback: ArtShape = "video"): ArtShape {
  const counts = new Map<ArtShape, number>();
  for (const shape of shapes) counts.set(shape, (counts.get(shape) ?? 0) + 1);
  let best = shapes[0] ?? fallback;
  for (const [shape, count] of counts) if (count > (counts.get(best) ?? 0)) best = shape;
  return best;
}

/** Square and round art are the same picture, so one never letterboxes in the other's frame. */
export const fillsFrame = (own: ArtShape, frame: ArtShape) => own === frame || own !== "poster" && own !== "video" && frame !== "poster" && frame !== "video";
