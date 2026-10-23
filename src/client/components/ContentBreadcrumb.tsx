import { flushSync } from "react-dom";
import { Fragment, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
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
type Crumb = { label: string; to: string; url?: string; children?: { parent: string; items: Sibling[] } };

/**
 * A content page's ancestors above its h1, each a link: the section it opened in (the shell's tab), Radio or its
 * source's home, then the collections holding it. The h1 names the page, so the trail stops before it, with no separator
 * past the last crumb. In the player (`player`) it is what holds what plays: the source and its collections, without the
 * section (Back says it), and only when a collection holds it. A crumb whose page is already loaded (a series, a channel)
 * has a menu of the collections in it, the one on the path marked. One quiet line: each name is capped (`cap`) and
 * truncates with its whole name on hover and focus, so no one long name crowds out the rest; only when the capped crumbs
 * still don't fit do the middle ones collapse into a menu, nearest the section first. Esc and the TV's Back go back in
 * history (navigation.ts).
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
  // The collections a loaded crumb lists, cached by its own page (SearchOnlineResults); nothing is fetched for them.
  const children = (parent: Crumb, child: string | undefined) => {
    if (!source || !parent.url || !child) return undefined;
    const items = client.getQueryData<ProviderPage>(["search", "provider-page", source, { url: parent.url }])?.items.filter(item => item.kind === "collection");
    if (!items || items.length < 2 || !items.some(item => item.url === child)) return undefined;
    return { parent: parent.label, items: items.map(item => ({ label: item.title, to: keepSection(collectionLocation(item), at), current: item.url === child })) };
  };
  crumbs.forEach((crumb, index) => { crumb.children = children(crumb, index < crumbs.length - 1 ? crumbs[index + 1]!.url : player ? undefined : url); });
  // The first crumb and the last ancestor stay; the ones between collapse, nearest the first first.
  const middle = crumbs.length > 2 ? crumbs.slice(1, -1) : [];
  const [hidden, setHidden] = useState(0);
  const nav = useRef<HTMLElement>(null);
  const trailKey = crumbs.map(crumb => crumb.to).join();
  useLayoutEffect(() => { setHidden(0); }, [trailKey]);
  // A crumb squeezed below its cap means the line is out of room: hide one more, until it fits or none is left to hide.
  useLayoutEffect(() => {
    const squeezed = [...nav.current?.querySelectorAll<HTMLElement>("[data-crumb-text]") ?? []]
      .some(text => text.clientWidth + 1 < Math.min(text.scrollWidth, parseFloat(getComputedStyle(text).maxWidth)));
    if (squeezed && hidden < middle.length) setHidden(hidden + 1);
  });
  useLayoutEffect(() => {
    const element = nav.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      flushSync(() => setHidden(0));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (!crumbs.length || player && !holders.length) return null;
  const open = (event: MouseEvent<HTMLAnchorElement>, to: string) => {
    // The player opens what holds it as Details do, so Back returns to the player.
    if (!player || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigation.open(to);
  };
  const collapsed = middle.slice(0, hidden);
  const shown = collapsed.length ? [crumbs[0]!, ...crumbs.slice(1 + collapsed.length)] : crumbs;
  const leading = "leading-8 touch:leading-11";
  return <Breadcrumb ref={nav} aria-label="Content path" className={cn("w-full min-w-0", className)}>
    <BreadcrumbList className="flex-nowrap gap-1.5 text-sm">
      {shown.map((crumb, index) => <Fragment key={crumb.to}>
        {index > 0 && <BreadcrumbSeparator />}
        {collapsed.length > 0 && index === 1 && <>
          <BreadcrumbItem className="shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger className={cn("flex items-center rounded-sm hover:text-foreground", leading)} aria-label={`Show ${collapsed.length} more in the path`}><BreadcrumbEllipsis className="h-8 w-6 touch:size-11" /></DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-w-[min(24rem,90vw)]">
                {collapsed.map(item => <DropdownMenuItem key={item.to} asChild className="whitespace-normal"><Link to={item.to} onClick={event => open(event, item.to)}>{item.label}</Link></DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
        </>}
        <BreadcrumbItem className={floor(crumb.label)}>
          <CrumbName label={crumb.label}>
            <BreadcrumbLink asChild><Link data-crumb-text to={crumb.to} activeOptions={{ exact: true }} onClick={event => open(event, crumb.to)} className={cn("block min-w-0 truncate rounded-sm", cap, leading)}>{crumb.label}</Link></BreadcrumbLink>
          </CrumbName>
          {crumb.children && <Children {...crumb.children} open={open} />}
        </BreadcrumbItem>
      </Fragment>)}
    </BreadcrumbList>
  </Breadcrumb>;
}

// About 24 characters of text, where a title's first words name it ("Tiny Desk Concerts: the…"): at the trail's type
// size a 46rem column holds the section, the source and two capped collections whole, and a phone the first crumb, "…"
// and one capped collection.
const cap = "max-w-[20ch]";

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

/** The collections in a crumb (a series' seasons), the one on the path marked: shadcn's breadcrumb with a dropdown. */
function Children({ parent, items, open }: { parent: string; items: Sibling[]; open: (event: MouseEvent<HTMLAnchorElement>, to: string) => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger className="flex h-8 w-6 shrink-0 items-center justify-center rounded-sm hover:text-foreground touch:size-11" aria-label={`More in ${parent}`}><ChevronDown aria-hidden="true" className="size-3.5" /></DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="max-w-[min(24rem,90vw)]">
      {items.map(item => <DropdownMenuItem key={item.to} asChild className="whitespace-normal"><Link to={item.to} aria-current={item.current ? "page" : undefined} className={cn(item.current && "text-foreground font-medium")} onClick={event => open(event, item.to)}>{item.label}</Link></DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
