import { Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { collectionLinks } from "@/collection-target";
import { collectionLocation, keepSection } from "@/detail-navigation";
import { useShell } from "@/sections/shell/shell-context";
import type { MediaCollection } from "../../shared/media";
import { providerForUrl, type ProviderId } from "../../shared/providers";
import { providerNames } from "@/sections/find/SearchOnlineResults";

const linkClassName = "inline-flex min-h-11 items-center px-1";

export function ContentBreadcrumb({ title, collection, provider, radio = false }: { title: string; collection?: MediaCollection; provider?: ProviderId; radio?: boolean }) {
  const { section, sectionUrl } = useShell();
  const source = provider ?? (collection ? providerForUrl(collection.url) : undefined);
  const collections = collectionLinks(collection);
  return <Breadcrumb aria-label="Content path">
    <BreadcrumbList className="text-sm">
      {/* It starts at the section the page opened in (the shell's tab), else Discover. */}
      <BreadcrumbItem><BreadcrumbLink asChild><Link to={sectionUrl(section)} className={linkClassName}>{section}</Link></BreadcrumbLink></BreadcrumbItem>
      {radio && <><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink asChild><Link to={keepSection("/discover/radio", section)} className={linkClassName}>Radio</Link></BreadcrumbLink></BreadcrumbItem></>}
      {!radio && source && (title !== providerNames[source] || collection) && <><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink asChild><Link to={keepSection(collectionLocation({ provider: source, url: "" }), section)} className={linkClassName}>{providerNames[source]}</Link></BreadcrumbLink></BreadcrumbItem></>}
      {collections.map(item => <Fragment key={item.url}>
        <BreadcrumbSeparator /><BreadcrumbItem className="min-w-0"><BreadcrumbLink asChild><Link to={keepSection(collectionLocation(item), section)} className={`${linkClassName} break-words`}>{item.title}</Link></BreadcrumbLink></BreadcrumbItem>
      </Fragment>)}
      <BreadcrumbSeparator /><BreadcrumbItem className="min-w-0"><BreadcrumbPage className="truncate">{title}</BreadcrumbPage></BreadcrumbItem>
    </BreadcrumbList>
  </Breadcrumb>;
}
