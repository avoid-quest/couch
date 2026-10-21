import { radioBrowseLocation, radioBrowseSources } from "@/radio-navigation";
import { searchLocation } from "@/search";
import { providerNames } from "../../shared/providers";
import type { ProviderId } from "../../shared/providers";
import { collectionLinks } from "@/collection-target";
import { collectionLocation, itemLocation } from "@/detail-navigation";
import { ContentLink } from "./ContentLink";
import type { CollectionLink, MediaCollection } from "../../shared/media";
import { providerForUrl } from "../../shared/providers";
import { cn } from "@/lib/utils";

/** Named relationships are destinations, never a string hidden in an item menu. */
export function MediaContext({ collection, creator, radio, source, className }: { source?: string; collection?: MediaCollection; creator?: CollectionLink; radio?: { id: string; title: string }; className?: string }) {
  const creatorProvider = creator && providerForUrl(creator.url);
  const provider = (Object.keys(providerNames) as ProviderId[]).find(id => providerNames[id] === source);
  const radioSource = radioBrowseSources.find(value => value === source);
  const sourceHref = provider ? collectionLocation({ provider, url: "" }) : radioSource || source === "Radio" ? radioBrowseLocation(radioSource) : source === "Live TV" ? "/discover/live-tv" : undefined;
  const links = [
    ...(source && sourceHref ? [{ title: source, href: sourceHref }] : []),
    ...(creator && creatorProvider ? [{ title: creator.title, href: ["bandcamp", "soundcloud"].includes(creatorProvider) ? searchLocation({query: creator.title, source: providerNames[creatorProvider]}) : collectionLocation({ provider: creatorProvider, url: creator.url }) }] : []),
    ...collectionLinks(collection).map(item => ({ title: item.title, href: collectionLocation(item) })),
    ...(radio ? [{ title: radio.title, href: itemLocation("radio", radio.id) }] : []),
  ].filter((link, index, all) => all.findIndex(other => other.href === link.href) === index);
  if (!links.length && !source) return null;
  return <span data-media-context className={cn("flex min-w-0 flex-wrap items-center gap-x-3 text-sm text-muted-foreground", className)}>
    {source && !sourceHref && <span>{source}</span>}
    {links.map(link => <ContentLink key={link.href} href={link.href} className="inline-flex min-h-8 max-w-full items-center break-words touch:min-h-11">{link.title}</ContentLink>)}
  </span>;
}

/** A linked creator or collection already supplies this byline. Keep other subtitle information. */
export function mediaSubtitle({ subtitle, creator, collection }: { subtitle?: string; creator?: CollectionLink; collection?: MediaCollection }) {
  const linked = [creator && providerForUrl(creator.url) ? creator.title : undefined, ...collectionLinks(collection).map(item => item.title)];
  return linked.includes(subtitle) ? undefined : subtitle;
}
