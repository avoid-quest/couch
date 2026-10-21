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
 * then the collections holding it. The h1 names the page, so the trail stops before it. One quiet line: when it runs out of
 * room the middle gives way first. Esc and the TV's Back go back in history (navigation.ts), not up the trail.
 */
export function ContentBreadcrumb({ title, collection, provider, radio = false }: { title?: string; collection?: MediaCollection; provider?: ProviderId; radio?: boolean }) {
  const { section, sectionUrl } = useShell();
  const source = provider ?? (collection ? providerForUrl(collection.url) : undefined);
  const trail = [
    { label: section, to: sectionUrl(section) },
    ...radio ? [{ label: "Radio", to: keepSection("/discover/radio", section) }]
      : source && (title !== providerNames[source] || collection) ? [{ label: providerNames[source], to: keepSection(collectionLocation({ provider: source, url: "" }), section) }] : [],
    ...collectionLinks(collection).map(item => ({ label: item.title, to: keepSection(collectionLocation(item), section) })),
  ];
  return <Breadcrumb aria-label="Content path" className="min-w-0">
    <BreadcrumbList className="flex-nowrap text-sm">
      {trail.map((crumb, index) => <Fragment key={crumb.to}>
        {index > 0 && <BreadcrumbSeparator />}
        <BreadcrumbItem className={index === 0 ? "shrink-0" : index < trail.length - 1 ? "min-w-0 shrink-[8]" : "min-w-0"}>
          <BreadcrumbLink asChild><Link to={crumb.to} title={crumb.label} className="block truncate leading-8 touch:leading-11">{crumb.label}</Link></BreadcrumbLink>
        </BreadcrumbItem>
      </Fragment>)}
    </BreadcrumbList>
  </Breadcrumb>;
}
