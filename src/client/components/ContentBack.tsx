import { BackLink } from "@/components/PageHeader";
import { collectionLinks } from "@/collection-target";
import { collectionLocation, keepSection } from "@/detail-navigation";
import { useShell } from "@/sections/shell/shell-context";
import type { MediaCollection } from "../../shared/media";
import { providerForUrl, type ProviderId } from "../../shared/providers";
import { providerNames } from "@/sections/find/SearchOnlineResults";

/**
 * A content page's one way up, above its h1: the collection holding it, else Radio or its source's home, else the
 * section it opened in (the shell's tab).
 */
export function ContentBack({ title, collection, provider, radio = false }: { title?: string; collection?: MediaCollection; provider?: ProviderId; radio?: boolean }) {
  const { section, sectionUrl } = useShell();
  const source = provider ?? (collection ? providerForUrl(collection.url) : undefined);
  const parent = collectionLinks(collection).at(-1);
  if (parent) return <BackLink label={parent.title} to={keepSection(collectionLocation(parent), section)} />;
  if (radio) return <BackLink label="Radio" to={keepSection("/discover/radio", section)} />;
  if (source && title !== providerNames[source]) return <BackLink label={providerNames[source]} to={keepSection(collectionLocation({ provider: source, url: "" }), section)} />;
  return <BackLink label={section} to={sectionUrl(section)} />;
}
