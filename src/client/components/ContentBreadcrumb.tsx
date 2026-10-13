import { Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { collectionLinks } from "@/collection-target";
import { collectionLocation } from "@/detail-navigation";
import type { MediaCollection } from "../../shared/media";
import { providerForUrl, type ProviderId } from "../../shared/providers";
import { providerNames } from "@/sections/find/SearchOnlineResults";

const linkClassName = "inline-flex min-h-11 items-center px-1";

export function ContentBreadcrumb({ title, collection, provider, radio = false, compact = false }: { title: string; collection?: MediaCollection; provider?: ProviderId; radio?: boolean; compact?: boolean }) {
  const source = provider ?? (collection ? providerForUrl(collection.url) : undefined);
  const collections = collectionLinks(collection);
  // The player already shows the title; keep its containing destinations beside the Couch switch.
  if (compact) {
    const path = collections.length ? collections.map(item => ({ title: item.title, href: collectionLocation(item) }))
      : [{ title: radio ? "Radio" : source ? providerNames[source] : "Find", href: radio ? "/find?browse=radio" : source ? collectionLocation({ provider: source, url: "" }) : "/find" }];
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
      <BreadcrumbItem><BreadcrumbLink asChild><Link to="/find" className={linkClassName}>Find</Link></BreadcrumbLink></BreadcrumbItem>
      {radio && title !== "Radio" ? <><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink asChild><Link to="/find" search={{ browse: "radio" }} className={linkClassName}>Radio</Link></BreadcrumbLink></BreadcrumbItem></> : source && (title !== providerNames[source] || collection) && <><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink asChild><Link to={collectionLocation({ provider: source, url: "" })} className={linkClassName}>{providerNames[source]}</Link></BreadcrumbLink></BreadcrumbItem></>}
      {collections.map(item => <Fragment key={item.url}>
        <BreadcrumbSeparator /><BreadcrumbItem className="min-w-0"><BreadcrumbLink asChild><Link to={collectionLocation(item)} className={`${linkClassName} break-words`}>{item.title}</Link></BreadcrumbLink></BreadcrumbItem>
      </Fragment>)}
      <BreadcrumbSeparator /><BreadcrumbItem className="min-w-0"><BreadcrumbPage className="truncate">{title}</BreadcrumbPage></BreadcrumbItem>
    </BreadcrumbList>
  </Breadcrumb>;
}
