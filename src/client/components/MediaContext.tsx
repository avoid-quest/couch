import { radioBrowseLocation, radioBrowseSources } from "@/radio-navigation";
import { searchLocation } from "@/search";
import { providerNames } from "../../shared/providers";
import type { ProviderId } from "../../shared/providers";
import { collectionLinks } from "@/collection-target";
import { collectionLocation, itemLocation, useDetailNavigation } from "@/detail-navigation";
import type { MenuAction } from "./RowMenu";
import { ContentLink } from "./ContentLink";
import type { CollectionLink, MediaCollection } from "../../shared/media";
import { providerForUrl } from "../../shared/providers";
import { cn } from "@/lib/utils";

export type Related = { source?: string; collection?: MediaCollection; creator?: CollectionLink; radio?: { id: string; title: string } };

/** An item's named relationships (its source, creator, series and season, station) as destinations. */
function relatedLinks({ collection, creator, radio, source }: Related) {
  const creatorProvider = creator && providerForUrl(creator.url);
  const provider = (Object.keys(providerNames) as ProviderId[]).find(id => providerNames[id] === source);
  const radioSource = radioBrowseSources.find(value => value === source);
  const sourceHref = provider ? collectionLocation({ provider, url: "" }) : radioSource || source === "Radio" ? radioBrowseLocation(radioSource) : source === "Live TV" ? "/live-tv" : undefined;
  const links = [
    ...(source && sourceHref ? [{ title: source, href: sourceHref }] : []),
    ...(creator && creatorProvider ? [{ title: creator.title, href: ["bandcamp", "soundcloud"].includes(creatorProvider) ? searchLocation({query: creator.title, source: providerNames[creatorProvider]}) : collectionLocation({ provider: creatorProvider, url: creator.url }) }] : []),
    ...collectionLinks(collection).map(item => ({ title: item.title, href: collectionLocation(item) })),
    ...(radio ? [{ title: radio.title, href: itemLocation("radio", radio.id) }] : []),
  ].filter((link, index, all) => all.findIndex(other => other.href === link.href) === index);
  return { links, sourceHref };
}

/**
 * A tile's or a row's relationships, as the last verbs in its menu ("Go to Phony"): a shelf or a list is pictures and
 * titles, and the item's own page and its menu hold where it leads.
 */
export function useRelatedMenu(related: Related | undefined): MenuAction[] {
  const navigation = useDetailNavigation();
  if (!related) return [];
  return relatedLinks(related).links.map(link => ({ label: `Go to ${link.title}`, run: () => navigation.open(link.href) }));
}

/** Named relationships as visible links, where an item has the room (a Stage, the player, the now-playing bar). */
export function MediaContext({ className, ...related }: Related & { className?: string }) {
  const { source } = related;
  const { links, sourceHref } = relatedLinks(related);
  if (!links.length && !source) return null;
  return <span data-media-context className={cn("flex min-w-0 flex-wrap items-center gap-x-3 text-sm text-muted-foreground", className)}>
    {source && !sourceHref && <span>{source}</span>}
    {links.map(link => <ContentLink key={link.href} href={link.href} className="inline-flex min-h-8 max-w-full items-center break-words touch:min-h-11">{link.title}</ContentLink>)}
  </span>;
}

// Providers space and case one name differently ("DISCOS REDONDOS  ( FULL ALBUMS )" as the link, with one space as the byline).
const sameName = (value?: string) => value?.replace(/\s+/g, " ").trim().toLocaleLowerCase();
/** A linked creator or collection already supplies this byline. Keep other subtitle information. */
export function mediaSubtitle({ subtitle, creator, collection }: { subtitle?: string; creator?: CollectionLink; collection?: MediaCollection }) {
  const linked = [creator && providerForUrl(creator.url) ? creator.title : undefined, ...collectionLinks(collection).map(item => item.title)].map(sameName);
  return subtitle && linked.includes(sameName(subtitle)) ? undefined : subtitle;
}
