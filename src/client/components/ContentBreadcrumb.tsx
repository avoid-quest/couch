import { Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { collectionLinks } from "@/collection-target";
import { collectionLocation, keepSection } from "@/detail-navigation";
import { useShell } from "@/sections/shell/shell-context";
import type { MediaCollection } from "../../shared/media";
import { providerForUrl, type ProviderId } from "../../shared/providers";
import { providerNames } from "@/sections/find/SearchOnlineResults";

/**
 * A content page's ancestors above its h1, each a link: the section it opened in (the shell's tab), Radio or its source's home,
 * then the collections holding it. The h1 names the page, so the trail stops before it. One quiet line: out of room, the
 * longest crumbs truncate first (grid tracks share the room evenly up to each one's width), usually the middle ones. Esc and the TV's Back go back in history (navigation.ts), not up the trail.
 */
export function ContentBreadcrumb({ title, collection, provider, radio = false }: { title?: string; collection?: MediaCollection; provider?: ProviderId; radio?: boolean }) {
  const { section, sectionUrl } = useShell();
  const source = provider ?? (collection ? providerForUrl(collection.url) : undefined);
  const trail = [
    { label: section, to: sectionUrl(section) },
    ...radio ? [{ label: "Radio", to: keepSection("/radio", section) }]
      : source && (title !== providerNames[source] || collection) ? [{ label: providerNames[source], to: keepSection(collectionLocation({ provider: source, url: "" }), section) }] : [],
    ...collectionLinks(collection).map(item => ({ label: item.title, to: keepSection(collectionLocation(item), section) })),
  ];
  return <Breadcrumb aria-label="Content path" className="min-w-0">
    <BreadcrumbList className="grid auto-cols-[minmax(0,max-content)] grid-flow-col justify-start text-sm">
      {/* Each crumb leads on to the next, the last to the h1 below; none is the page itself, so none is current and
          no separator points past the last. */}
      {trail.map((crumb, index) => <Fragment key={crumb.to}>
        {index > 0 && <BreadcrumbSeparator />}
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbLink asChild><Link to={crumb.to} activeOptions={{ exact: true }} title={crumb.label} className="block truncate leading-8 touch:leading-11">{crumb.label}</Link></BreadcrumbLink>
        </BreadcrumbItem>
      </Fragment>)}
    </BreadcrumbList>
  </Breadcrumb>;
}
