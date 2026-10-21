import type { MediaCollection } from "../shared/media";
import type { HistoryItem } from "../shared/viewing";
import type { ForLaterItem } from "../shared/for-later";
import { mediaSubtitle } from "@/components/MediaContext";
import { savedSourceLabel } from "@/saved-source";

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

// A caption leads with the series for an episode ("Phony", then "S1 E1, Episodio 1"), then its subtitle and source.
export const historyCaption = (item: HistoryItem) => { const caption = mediaCaption(item); return { title: caption.title, meta: metaLine(caption.lead, item.creator?.title === caption.subtitle ? undefined : caption.subtitle, item.sourceLabel) }; };
export const savedCaption = (item: ForLaterItem) => { const caption = mediaCaption(item); return { title: caption.title, meta: metaLine(caption.lead, mediaSubtitle({ ...item, subtitle: caption.subtitle }), savedSourceLabel(item)) }; };

/** One meta line, one separator: its parts (a provider's own "Game · 1,204 viewers" among them) joined by commas. */
export const metaLine = (...parts: (string | false | null | undefined)[]) => parts.flatMap(part => part ? part.split(" · ") : []).map(part => part.trim()).filter(Boolean).join(", ");

// A bare address says nothing on screen, nor does the label in front of it ("Listen to Miles Davis: https://…").
const address = /(?:https?:\/\/|www\.)[^\s<>"]+/gi;
const label = /(?:^|\s)(?:[^\s:]+\s+){0,3}[^\s:]+:\s*$/u;
const words = (text: string) => text.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
/**
 * A description without bare URLs. A line with one keeps its own words; a line of several (a snippet's link list) keeps
 * what came before the first. A label ending in a colon goes with its address, and a line left with three words or
 * fewer goes.
 */
export const withoutUrls = (text?: string | null) => (text ?? "").split("\n").flatMap(line => {
  const found = line.match(address);
  if (!found) return [line];
  const first = line.search(address);
  const head = line.slice(0, first).replace(label, "");
  const rest = (found.length > 1 ? head : `${head} ${line.slice(first).replace(address, "")}`).replace(/\s+/g, " ").trim();
  return words(rest) > 3 ? [rest] : [];
}).join("\n").replace(/\n{3,}/g, "\n\n").trim();

// YouTube names a channel's tab "Stanford - Videos"; the page is the channel.
const channelTab = /\s+[-–]\s+(?:Videos|Shorts|Live|Streams|Playlists|Podcasts|Releases|Courses|Home|Featured|Community)$/;
/** A page's own name, without the channel tab it opened on. */
export const pageTitle = (title: string) => title.replace(channelTab, "");
/** The page is one of a channel's tabs. */
export const isChannelTab = (title: string) => channelTab.test(title);

/** "S1 E2" for an episode, from its title ("S01E02 · …") or its place in a numbered season; nothing otherwise. */
export function episodeLabel({ title, collection }: { title: string; collection?: MediaCollection | null }) {
  const episode = episodeTitle.exec(title);
  if (episode) return `S${Number(episode[1])} E${Number(episode[2])}`;
  const season = collection?.title.match(/\b(?:Season|Stagione)\s+(\d{1,3})\b/i);
  return season && collection?.index != null ? `S${Number(season[1])} E${collection.index + 1}` : undefined;
}
