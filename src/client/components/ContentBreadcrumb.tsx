import { Fragment, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { collectionLinks } from "@/collection-target";
import { collectionLocation, keepSection, useDetailNavigation } from "@/detail-navigation";
import { useShell } from "@/sections/shell/shell-context";
import { cn } from "@/lib/utils";
import type { MediaCollection } from "../../shared/media";
import { providerForUrl, type ProviderId, type ProviderPage } from "../../shared/providers";
import { providerNames } from "@/sections/find/SearchOnlineResults";

type Sibling = { label: string; to: string; current: boolean };
type Crumb = { label: string; to: string; url?: string; siblings?: { parent: string; items: Sibling[] } };

/**
 * A content page's real path, each ancestor a link: the section it opened in (the shell's tab), Radio or its source's
 * home, the collections holding it, then the page itself (`title`). In the player (`player`) it is what holds what plays:
 * the source and its collections, without the section (Back says it) or the title (the h1 beside it), and only when a
 * collection holds it. A crumb whose parent's page is already loaded (a series' seasons, a channel's playlists) has a
 * menu of its siblings. One quiet line: out of room, the middle crumbs collapse into a menu, and only what is left
 * truncates, with the whole name on hover and focus. Esc and the TV's Back go back in history (navigation.ts).
 */
export function ContentBreadcrumb({ title, url, collection, provider, radio = false, player = false, className }: { title?: string; url?: string; collection?: MediaCollection; provider?: ProviderId; radio?: boolean; player?: boolean; className?: string }) {
  const { section, sectionUrl } = useShell();
  const client = useQueryClient();
  const navigation = useDetailNavigation();
  const source = provider ?? (collection ? providerForUrl(collection.url) : undefined);
  const holders = collectionLinks(collection);
  const at = player ? undefined : section;
  const crumbs: Crumb[] = [
    ...player ? [] : [{ label: section, to: sectionUrl(section) }],
    ...radio ? [{ label: "Radio", to: keepSection("/radio", at) }]
      : source && (title !== providerNames[source] || collection) ? [{ label: providerNames[source], to: keepSection(collectionLocation({ provider: source, url: "" }), at) }] : [],
    ...holders.map(item => ({ label: item.title, to: keepSection(collectionLocation(item), at), url: item.url })),
  ];
  // The siblings a loaded parent lists, cached by its own page (SearchOnlineResults); nothing is fetched for them.
  const siblings = (parent: Crumb | undefined, child: string | undefined) => {
    if (!source || !parent?.url || !child) return undefined;
    const items = client.getQueryData<ProviderPage>(["search", "provider-page", source, { url: parent.url }])?.items.filter(item => item.kind === "collection");
    if (!items || items.length < 2 || !items.some(item => item.url === child)) return undefined;
    return { parent: parent.label, items: items.map(item => ({ label: item.title, to: keepSection(collectionLocation(item), at), current: item.url === child })) };
  };
  crumbs.forEach((crumb, index) => { crumb.siblings = siblings(crumbs[index - 1], crumb.url); });
  const page = title && !player ? { label: title, siblings: siblings(crumbs.at(-1), url) } : undefined;
  // The first crumb and the last ancestor stay; the ones between collapse first.
  const middle = crumbs.length > 2 ? crumbs.slice(1, -1) : [];
  const [collapsed, setCollapsed] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const full = useRef(0);
  const trailKey = crumbs.map(crumb => crumb.to).join() + (page?.label ?? "");
  useLayoutEffect(() => { setCollapsed(false); }, [trailKey]);
  useLayoutEffect(() => {
    const element = nav.current;
    if (!element || !middle.length) return;
    const fit = () => {
      const width = element.clientWidth;
      if (collapsed) { if (width >= full.current) setCollapsed(false); return; }
      // The room the whole trail needs: what it has, plus what each truncated name is missing.
      const missing = [...element.querySelectorAll<HTMLElement>("[data-crumb-text]")].reduce((sum, text) => sum + Math.max(0, text.scrollWidth - text.clientWidth), 0);
      if (missing > 1) { full.current = width + missing; setCollapsed(true); }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [collapsed, middle.length, trailKey]);
  if (!crumbs.length && !page || player && !holders.length) return null;
  const open = (event: MouseEvent<HTMLAnchorElement>, to: string) => {
    // The player opens what holds it as Details do, so Back returns to the player.
    if (!player || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigation.open(to);
  };
  const shown = collapsed ? [crumbs[0]!, crumbs.at(-1)!] : crumbs;
  const leading = "leading-8 touch:leading-11";
  return <Breadcrumb ref={nav} aria-label="Content path" className={cn("w-full min-w-0", className)}>
    <BreadcrumbList className="flex-nowrap gap-1.5 text-sm">
      {shown.map((crumb, index) => <Fragment key={crumb.to}>
        {index > 0 && <BreadcrumbSeparator />}
        {collapsed && index === 1 && <>
          <BreadcrumbItem className="shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger className={cn("flex items-center rounded-sm hover:text-foreground", leading)} aria-label={`Show ${middle.length} more in the path`}><BreadcrumbEllipsis className="size-8 touch:size-11" /></DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-w-[min(24rem,90vw)]">
                {middle.map(item => <DropdownMenuItem key={item.to} asChild className="whitespace-normal"><Link to={item.to} onClick={event => open(event, item.to)}>{item.label}</Link></DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
        </>}
        <BreadcrumbItem className={floor(crumb.label)}>
          <CrumbName label={crumb.label}>
            <BreadcrumbLink asChild><Link data-crumb-text to={crumb.to} activeOptions={{ exact: true }} onClick={event => open(event, crumb.to)} className={cn("block min-w-0 truncate rounded-sm", leading)}>{crumb.label}</Link></BreadcrumbLink>
          </CrumbName>
          {crumb.siblings && <Siblings {...crumb.siblings} open={open} />}
        </BreadcrumbItem>
      </Fragment>)}
      {page && <>
        {shown.length > 0 && <BreadcrumbSeparator />}
        {/* The page gives up its room first: the h1 names it in full. */}
        <BreadcrumbItem className={cn(floor(page.label), "shrink-[100000]")}>
          <CrumbName label={page.label}><BreadcrumbPage data-crumb-text className={cn("block min-w-0 truncate", leading)}>{page.label}</BreadcrumbPage></CrumbName>
          {page.siblings && <Siblings {...page.siblings} open={open} />}
        </BreadcrumbItem>
      </>}
    </BreadcrumbList>
  </Breadcrumb>;
}

// A name truncates to no less than six characters; a shorter one never truncates.
const floor = (label: string) => label.length > 6 ? "min-w-[6ch]" : "shrink-0";

/** A crumb's name, whole on hover and focus once it truncates. */
function CrumbName({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement>(null);
  return <Tooltip open={open} onOpenChange={next => setOpen(next && !!trigger.current && trigger.current.scrollWidth > trigger.current.clientWidth)}>
    <TooltipTrigger asChild ref={trigger as RefObject<HTMLButtonElement | null>}>{children}</TooltipTrigger>
    <TooltipContent side="bottom" align="start" className="max-w-[min(24rem,90vw)]">{label}</TooltipContent>
  </Tooltip>;
}

/** The crumb's siblings in its parent (the other seasons of its series), shadcn's breadcrumb with a dropdown. */
function Siblings({ parent, items, open }: { parent: string; items: Sibling[]; open: (event: MouseEvent<HTMLAnchorElement>, to: string) => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger className="flex size-8 shrink-0 items-center justify-center rounded-sm hover:text-foreground touch:size-11" aria-label={`Others in ${parent}`}><ChevronDown aria-hidden="true" className="size-3.5" /></DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="max-w-[min(24rem,90vw)]">
      {items.map(item => <DropdownMenuItem key={item.to} asChild className="whitespace-normal"><Link to={item.to} aria-current={item.current ? "page" : undefined} className={cn(item.current && "text-foreground font-medium")} onClick={event => open(event, item.to)}>{item.label}</Link></DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
