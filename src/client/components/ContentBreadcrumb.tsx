import { Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { collectionLinks } from "@/collection-target";
import { collectionLocation } from "@/detail-navigation";
import type { MediaCollection } from "../../shared/media";
import { providerForUrl, type ProviderId } from "../../shared/providers";
import { providerNames } from "@/sections/find/SearchOnlineResults";

export function ContentBreadcrumb({ title, collection, provider, radio = false }: { title: string; collection?: MediaCollection; provider?: ProviderId; radio?: boolean }) {
  const source = provider ?? (collection ? providerForUrl(collection.url) : undefined);
  return <Breadcrumb aria-label="Content path">
    <BreadcrumbList className="text-sm">
      <BreadcrumbItem><BreadcrumbLink asChild><Link to="/find" className="inline-flex min-h-11 items-center px-1">Find</Link></BreadcrumbLink></BreadcrumbItem>
      {radio && title !== "Radio" ? <><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink asChild><Link to="/find" search={{ browse: "radio" }} className="inline-flex min-h-11 items-center px-1">Radio</Link></BreadcrumbLink></BreadcrumbItem></> : source && (title !== providerNames[source] || collection) && <><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink asChild><Link to={collectionLocation({ provider: source, url: "" })} className="inline-flex min-h-11 items-center px-1">{providerNames[source]}</Link></BreadcrumbLink></BreadcrumbItem></>}
      {collectionLinks(collection).map(item => <Fragment key={item.url}>
        <BreadcrumbSeparator /><BreadcrumbItem className="min-w-0"><BreadcrumbLink asChild><Link to={collectionLocation(item)} className="inline-flex min-h-11 items-center px-1 break-words">{item.title}</Link></BreadcrumbLink></BreadcrumbItem>
      </Fragment>)}
      <BreadcrumbSeparator /><BreadcrumbItem className="min-w-0"><BreadcrumbPage className="truncate">{title}</BreadcrumbPage></BreadcrumbItem>
    </BreadcrumbList>
  </Breadcrumb>;
}
