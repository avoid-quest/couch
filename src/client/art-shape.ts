/**
 * Artwork's true shape, one per kind of item: 2:3 posters for films and series, 16:9 frames for videos and streams,
 * squares for music and stations, circles for people and channels. Tiles, rows and the Home hero draw it; a shelf or a
 * list takes its majority shape, so its tiles line up, and an item of another shape is contained in that frame.
 */
export type ArtShape = "poster" | "square" | "video" | "round";
export type ArtKind = "media" | "episode" | "collection" | "channel" | "station";

export const artAspect = { poster: "aspect-[2/3]", square: "aspect-square", video: "aspect-video", round: "aspect-square rounded-full" } as const satisfies Record<ArtShape, string>;

// One geometry per shape, sized by height (`--detail-art`) so a poster, a square, a frame and a channel carry about the
// same weight; the width follows the shape, and the header's column caps it.
export const detailArt = {
  poster: "[--detail-art:15rem] md:[--detail-art:20rem] w-[calc(var(--detail-art)*2/3)]",
  square: "[--detail-art:13rem] md:[--detail-art:16rem] w-(--detail-art)",
  round: "[--detail-art:12rem] md:[--detail-art:14rem] w-(--detail-art)",
  video: "[--detail-art:12rem] md:[--detail-art:13.5rem] w-[calc(var(--detail-art)*16/9)]",
} as const satisfies Record<ArtShape, string>;

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
