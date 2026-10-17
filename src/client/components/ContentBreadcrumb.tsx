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

export function ContentBreadcrumb({ title, collection, provider, radio = false, compact = false }: { title: string; collection?: MediaCollection; provider?: ProviderId; radio?: boolean; compact?: boolean }) {
  const { section, sectionUrl } = useShell();
  const source = provider ?? (collection ? providerForUrl(collection.url) : undefined);
  const collections = collectionLinks(collection);
  // The player already shows the title; keep its containing destinations beside the Couch switch.
  if (compact) {
    const path = collections.length ? collections.map(item => ({ title: item.title, href: collectionLocation(item) }))
      : [{ title: radio ? "Live" : source ? providerNames[source] : "Search", href: radio ? "/live" : source ? collectionLocation({ provider: source, url: "" }) : "/search" }];
    return <Breadcrumb aria-label="Content path">
      <BreadcrumbList className="flex-nowrap gap-1 text-sm">
        {path.map((item, index) => <Fragment key={item.href}>
          {index > 0 && <BreadcrumbSeparator className="shrink-0" />}
          <BreadcrumbItem className="min-w-11"><BreadcrumbLink asChild><Link to={item.href} className={`${linkClassName} min-w-11`} title={item.title}><span className="truncate">{item.title}</span></Link></BreadcrumbLink></BreadcrumbItem>
        </Fragment>)}
      </BreadcrumbList>
    </Breadcrumb>;
  }
  return <Breadcrumb aria-label="Content path">
    <BreadcrumbList className="text-sm">
      {/* It starts at the section the page opened in (the shell's tab): a station's at Live, otherwise Search. */}
      <BreadcrumbItem><BreadcrumbLink asChild><Link to={sectionUrl(section)} className={linkClassName}>{section}</Link></BreadcrumbLink></BreadcrumbItem>
      {!radio && source && (title !== providerNames[source] || collection) && <><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink asChild><Link to={keepSection(collectionLocation({ provider: source, url: "" }), section)} className={linkClassName}>{providerNames[source]}</Link></BreadcrumbLink></BreadcrumbItem></>}
      {collections.map(item => <Fragment key={item.url}>
        <BreadcrumbSeparator /><BreadcrumbItem className="min-w-0"><BreadcrumbLink asChild><Link to={keepSection(collectionLocation(item), section)} className={`${linkClassName} break-words`}>{item.title}</Link></BreadcrumbLink></BreadcrumbItem>
      </Fragment>)}
      <BreadcrumbSeparator /><BreadcrumbItem className="min-w-0"><BreadcrumbPage className="truncate">{title}</BreadcrumbPage></BreadcrumbItem>
    </BreadcrumbList>
  </Breadcrumb>;
}
