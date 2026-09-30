import { Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { collectionLinks } from "@/collection-target";
import { collectionLocation } from "@/detail-navigation";
import type { MediaCollection } from "../../shared/media";
import type { ProviderId } from "../../shared/providers";
import { providerNames } from "@/sections/find/SearchOnlineResults";

export function ContentBreadcrumb({ title, collection, provider }: { title: string; collection?: MediaCollection; provider?: ProviderId }) {
  return <Breadcrumb aria-label="Content path">
    <BreadcrumbList className="text-sm">
      <BreadcrumbItem><BreadcrumbLink asChild><Link to="/find" className="inline-flex min-h-11 items-center px-1">Find</Link></BreadcrumbLink></BreadcrumbItem>
      {provider && <><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink asChild><Link to="/find" search={{ source: providerNames[provider] }} className="inline-flex min-h-11 items-center px-1">{providerNames[provider]}</Link></BreadcrumbLink></BreadcrumbItem></>}
      {collectionLinks(collection).map(item => <Fragment key={item.url}>
        <BreadcrumbSeparator /><BreadcrumbItem className="min-w-0"><BreadcrumbLink asChild><Link to={collectionLocation(item)} className="inline-flex min-h-11 items-center px-1 break-words">{item.title}</Link></BreadcrumbLink></BreadcrumbItem>
      </Fragment>)}
      <BreadcrumbSeparator /><BreadcrumbItem className="min-w-0"><BreadcrumbPage className="break-words">{title}</BreadcrumbPage></BreadcrumbItem>
    </BreadcrumbList>
  </Breadcrumb>;
}
