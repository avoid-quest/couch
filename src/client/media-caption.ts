import type { MediaCollection } from "../shared/media";

// StreamingCommunity names an episode "S01E01 · Episodio 1" (src/server/streamingcommunity.ts).
const episodeTitle = /^S(\d{1,3})E(\d{1,4})(?: · (.+))?$/;

/**
 * A tile's or a row's title and the start of its meta line. An episode leads with its series ("Phony") and its meta
 * starts "S1 E1, Episodio 1"; anything else keeps its own title.
 */
export function mediaCaption({ title, subtitle, collection }: { title: string; subtitle?: string; collection?: MediaCollection }): { title: string; lead?: string; subtitle?: string } {
  const episode = episodeTitle.exec(title);
  const series = collection?.parent?.title ?? subtitle ?? collection?.title;
  if (!episode || !series) return { title, subtitle };
  return { title: series, lead: [`S${Number(episode[1])} E${Number(episode[2])}`, episode[3]].filter(Boolean).join(", "), subtitle: subtitle === series ? undefined : subtitle };
}

/** One meta line, one separator: its parts (a provider's own "Game · 1,204 viewers" among them) joined by commas. */
export const metaLine = (...parts: (string | false | null | undefined)[]) => parts.flatMap(part => part ? part.split(" · ") : []).map(part => part.trim()).filter(Boolean).join(", ");
