import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { useLocation, useRouter } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useIsFetching, useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useCommandState } from "cmdk";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { focusPageControl } from "@/navigation";
import { isLink, readSearchState, searchLocation } from "@/search";
import { chooseScope, completeScope, dropScope, hasScope, isChosen, kindLabels, scopeLabels, scopes, suggest, type Scope, type SearchScope } from "@/search-palette";
import { isTvPresentation } from "@/session/presentation";
import { useSessionGate } from "@/session/session-context";
import { createId } from "@/session/session";
import { useShell } from "@/sections/shell/shell-context";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { collectionLocation, itemLocation, useDetailNavigation } from "@/detail-navigation";
import { forLaterQuery } from "@/api/for-later";
import { historyQuery } from "@/api/progress";
import { providerFavoritesQuery } from "@/api/providers";
import { radioFavoritesListQuery, radioSearchQuery } from "@/api/radio";
import { cn } from "@/lib/utils";
import { providerForUrl, providerNames } from "../../../shared/providers";
import type { RadioStation } from "../../../shared/radio";
import { readSearchRecents, rememberSearch } from "./search-recents";

const none = "none";
const kindScopes = scopes.filter(scope => scope.kind);
const sourceOf = (url?: string) => { const provider = url ? providerForUrl(url) : undefined; return provider && providerNames[provider]; };

/**
 * The header's search field, on every page, as a command palette (shadcn Command). Focused, it lists the kinds to search
 * in, recent searches and what was played; typing suggests only what the client already holds.
 * A scope becomes a token in the field (pick it, or type its name and Tab; Backspace removes it), and on the results
 * page the token is the page's kind and source, both ways. Enter on the query opens /search?q=…&kind=…&source=…; Enter on
 * a suggestion opens it, or plays a station or a pasted link. An empty query is Discover. It is the TV's Search field
 * too, which a phone's Remote types into (Type on TV), and `/` focuses it.
 */
export function HeaderSearch({ className }: { className?: string }) {
  const router = useRouter();
  const { pathname, searchStr } = useLocation();
  const { connected, credentials, run, videoQualityPreference } = useSessionGate();
  const shell = useShell();
  const details = useDetailNavigation();
  const installationId = credentials?.installationId ?? "";
  const results = pathname === "/search";
  const route = results ? readSearchState(searchStr) : null;
  const routeQuery = route?.query ?? "";
  // The typed query follows the route's query (the results', else empty) until the next edit; a new scope keeps it.
  const routeKey = `${pathname}?${routeQuery}`;
  const [draft, setDraft] = useState({ route: routeKey, value: routeQuery });
  if (draft.route !== routeKey) setDraft({ route: routeKey, value: routeQuery });
  const value = draft.value;
  const text = value.trim();
  const link = isLink(text);
  // The field spins only while the submitted query's sources answer.
  const fetching = useIsFetching({ queryKey: ["search", "providers"] });
  const [open, setOpen] = useState(false);
  // The palette's selected row: a pasted link's Play, else the query; none while the field is empty (Enter then submits).
  const [selected, setSelected] = useState(none);
  const first = (next: string) => !next.trim() ? none : isLink(next.trim()) && connected ? "link:play" : "query";
  const type = (next: string) => { setDraft(current => ({ ...current, value: next })); setSelected(first(next)); setOpen(true); };
  const show = () => { setSelected(first(value)); setOpen(true); };
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  // The scope is the results' kind and source; elsewhere, what a source or the palette gave the field until the results carry it.
  const scope: SearchScope = route ? { kind: route.kind, source: route.source } : shell.searchScope ?? { source: "All" };
  const rescope = (next: SearchScope) => route ? shell.changeSearch({ ...route, kind: next.kind, source: next.source }) : shell.setSearchScope(hasScope(next) ? next : null);
  useEffect(() => { if (results) shell.setSearchScope(null); }, [results]);
  // A source that scopes the field (Discover's YouTube) opens it, on the TV too.
  useEffect(() => { if (shell.searchScope && !open && document.activeElement === input.current) show(); }, [shell.searchScope]);
  // The palette belongs to the focused field: a page that changes under it (a played link opens the player, which hides
  // the header without blurring the field) closes it.
  useEffect(() => { if (document.activeElement !== input.current) setOpen(false); }, [pathname]);
  const [recents, setRecents] = useState<string[]>([]);
  useEffect(() => { setRecents(installationId ? readSearchRecents(installationId) : []); }, [installationId]);
  const search = (query: string, action: "clear" | "submit" | "enter" = "clear") => {
    if (!query && !results) return;
    const href = query ? searchLocation({ query, ...isLink(query) ? { source: "All" } : scope }) : "/discover";
    if (query && !isLink(query) && installationId) setRecents(rememberSearch(installationId, query));
    if (action !== "clear") setOpen(false);
    // Submission goes on to the results; clearing keeps focus here (on the TV too).
    if (href !== pathname + searchStr) void router.navigate({ href, replace: results, ...action !== "clear" ? {} : { state: { detailFocus: { selector: "#media-search", index: 0 } } } });
    else if (action !== "clear") {
      // Enter on results plays the closest match when its press plays (a station, a live stream); otherwise it goes to it.
      const first = document.querySelector<HTMLElement>("[data-page] [data-page-first]");
      if (action === "enter" && first?.closest("[data-search-top]") && first.textContent?.startsWith("Play")) first.click();
      else first?.focus();
    }
  };
  const busy = connected && results && fetching > 0;
  const pick = (query: string) => { type(query); search(query, "submit"); };
  const choose = (next: Scope, completing = false) => { rescope(completing && isChosen(scope, next) ? scope : chooseScope(scope, next)); if (text && completeScope(text) === next) type(""); };
  const leave = (then: () => void) => { setOpen(false); then(); };
  // On the results page, typing anywhere outside a control goes on with the query.
  const typeToSearch = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1 || event.key === " " || document.querySelector('[role="dialog"][data-state="open"]')) return;
    if (!(event.target instanceof HTMLElement) || event.target.closest("button, a, input, select, textarea, summary, [role=button], [role=link], [role=option], [contenteditable=true]")) return;
    input.current?.focus();
    type(`${value}${event.key}`);
    event.preventDefault();
  });
  useEffect(() => {
    if (!results) return;
    const onKeyDown = (event: KeyboardEvent) => typeToSearch(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [results]);
  const clear = () => { type(""); shell.setSearchScope(null); search(""); input.current?.focus(); };
  const close = () => { setOpen(false); input.current?.blur(); };
  // Left and Right move between the TV's columns in the empty palette, and along the kinds elsewhere, where they are a line.
  const list = useRef<HTMLDivElement>(null);
  const across = (step: number) => {
    const columns = [...list.current?.querySelectorAll<HTMLElement>("[data-palette-column]") ?? []].filter(column => column.querySelector("[cmdk-item]"));
    const items = (column?: HTMLElement) => [...column?.querySelectorAll<HTMLElement>('[cmdk-item]:not([aria-disabled="true"])') ?? []];
    const at = columns.findIndex(column => column.querySelector('[cmdk-item][aria-selected="true"]'));
    const row = items(columns[at]).findIndex(item => item.getAttribute("aria-selected") === "true");
    const next = isTvPresentation()
      ? items(columns[at + step]).at(Math.min(row, items(columns[at + step]).length - 1))
      : columns[at]?.hasAttribute("data-palette-kinds") ? items(columns[at])[row + step] : undefined;
    if (at < 0 || !next) return false;
    setSelected(next.getAttribute("data-value")!);
    return true;
  };
  // A link plays as itself, outside any scope.
  const labels = link ? [] : scopeLabels(scope);
  const tokens = useId();
  return <form role="search" aria-label="Search" aria-busy={busy} data-search-open={open || undefined} className={cn("flex min-w-0 items-center gap-1", className)}
    onSubmit={event => { event.preventDefault(); if (!composing.current) search(text, (event.nativeEvent as SubmitEvent).submitter ? "submit" : "enter"); }}
    onFocus={event => { if ((event.target as Node) === input.current && !open && !isTvPresentation()) show(); }}
    onBlur={event => { if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setOpen(false); }}>
    <Command label="Search or paste a link" shouldFilter={false} loop={false} vimBindings={false} value={selected} onValueChange={setSelected} className="relative min-w-0 flex-1">
      {/* InputGroup keeps its input/addon behavior; the header gives search a quiet filled surface. Focused, it inverts
          at once; while the palette is open its selected row is the one white thing, so the field takes a white edge instead. */}
      <InputGroup className={cn("h-11 rounded-md border-transparent bg-muted transition-colors dark:bg-muted has-[[data-slot=input-group-control]:focus-visible]:ring-0",
        open ? "border-foreground" : "has-[input:focus]:border-foreground has-[input:focus]:bg-foreground has-[input:focus]:text-background has-[input:focus]:duration-0")}>
        <InputGroupAddon className={cn("min-w-0 shrink pl-2.5", !open && "group-has-[input:focus]/input-group:text-background/65")}>
          <InputGroupButton type="submit" size="icon-xs" className="shrink-0 touch:size-11" aria-label="Search" title="Search">{busy ? <Spinner aria-hidden="true" /> : <Search aria-hidden="true" />}</InputGroupButton>
          {/* The scope's tokens: a press removes one (the keyboard's Backspace, the TV's own row in the palette). */}
          {labels.map(label => <button key={label} type="button" tabIndex={-1} data-search-token aria-label={`Remove ${label}`} title={`Remove ${label}`} onPointerDown={event => event.preventDefault()}
            onClick={() => { rescope(label === scope.source ? { kind: scope.kind, source: "All" } : { source: scope.source }); input.current?.focus(); }}
            className={cn("min-w-0 max-w-32 truncate rounded-sm bg-foreground/15 px-1.5 py-0.5 text-sm font-medium text-foreground", !open && "group-has-[input:focus]/input-group:bg-background/15 group-has-[input:focus]/input-group:text-background")}>{label}</button>)}
        </InputGroupAddon>
        <span id={tokens} hidden>{labels.length ? `In ${labels.join(", ")}` : ""}</span>
        <PaletteInput ref={input} open={open} id="media-search" data-remote-field="find" type="search" aria-label="Search or paste a link" aria-describedby={labels.length ? tokens : undefined} placeholder="Search" maxLength={4096} autoComplete="off"
          className={cn("h-full min-w-16 text-base md:text-base caret-current focus:duration-0 focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden", !open && "group-has-[input:focus]/input-group:placeholder:text-background/65")} value={value}
          onChange={event => type(event.target.value)}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={event => { composing.current = false; type(event.currentTarget.value); }}
          onKeyDown={event => {
            const plain = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
            if (event.key === "Enter") {
              if (event.nativeEvent.isComposing || composing.current || event.nativeEvent.keyCode === 229) { event.preventDefault(); return; }
              // Closed, Enter submits without the Search button, as Type on TV does; the TV's OK opens the palette instead.
              // Open, it does the selected row (the palette's own Enter), or submits while none is.
              if (!open || selected === none) { event.preventDefault(); if (!open && isTvPresentation()) show(); else event.currentTarget.form?.requestSubmit(); }
            }
            // Off the TV, Esc clears the open palette's field, then closes it and leaves; a closed palette's field (after a
            // search) it just leaves. The TV's Back closes the palette, then stays Back.
            else if (event.key === "Escape") {
              if (!isTvPresentation()) { event.preventDefault(); if (open && value) clear(); else { if (!results) shell.setSearchScope(null); close(); } }
              else if (open) { event.preventDefault(); setOpen(false); }
            }
            // Tab turns a scope's name into its token; Backspace in an empty field takes the last token away.
            else if (event.key === "Tab" && plain && open && !link && completeScope(text)) { event.preventDefault(); choose(completeScope(text)!, true); }
            else if (event.key === "Backspace" && !value && hasScope(scope)) { event.preventDefault(); rescope(dropScope(scope)); }
            // The field keeps Home and End for its text.
            else if (event.key === "Home" || event.key === "End") event.stopPropagation();
            else if (open && !value && plain && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { if (across(event.key === "ArrowLeft" ? -1 : 1)) event.preventDefault(); }
            // Closed, Down goes on to the page, as it does from the header's tabs.
            else if (event.key === "ArrowDown" && plain && !open) {
              const page = document.querySelector<HTMLElement>("[data-page]");
              if (page) { event.preventDefault(); focusPageControl(page); }
            }
          }} />
        {!value && !labels.length && <InputGroupAddon align="inline-end" className="hidden pointer-fine:flex touch:hidden group-has-[input:focus]/input-group:invisible tv:hidden"><Kbd aria-hidden="true">/</Kbd></InputGroupAddon>}
        {(value || labels.length > 0) && <InputGroupAddon align="inline-end" className={cn("pr-2.5", !open && "group-has-[input:focus]/input-group:text-background/65")}><InputGroupButton size="icon-xs" className="touch:size-11" aria-label="Clear search" onClick={clear}><X aria-hidden="true" /></InputGroupButton></InputGroupAddon>}
      </InputGroup>
      {/* On a desktop, the field's own list: under it, its width and its left edge, on the menus' ground. On a phone and
          the TV, the whole screen under the header. A press keeps the field focused (a tap or a Safari click would blur
          it first and take the list away). */}
      {open && <CommandList ref={list} label="Suggestions" onPointerDown={event => event.preventDefault()}
        className="absolute inset-x-0 top-full z-30 mt-1 max-h-[min(36rem,calc(100dvh-var(--top-bar,4rem)-1rem))] rounded-md bg-popover p-1 touch:fixed touch:top-(--top-bar) touch:bottom-0 touch:mt-0 touch:max-h-none touch:rounded-none touch:bg-background touch:px-[calc(var(--gutter)-0.5rem)] touch:pt-4 tv:fixed tv:top-(--top-bar) tv:bottom-0 tv:mt-0 tv:max-h-none tv:rounded-none tv:bg-background tv:px-[calc(var(--gutter)-0.5rem)] tv:py-8 tv:**:[[cmdk-item]]:min-h-10 tv:**:[[cmdk-item]]:text-base tv:**:[[cmdk-group-heading]]:text-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150">
        {text
          ? <Typed text={text} link={link} scope={scope} labels={labels} recents={recents} connected={connected}
            onSearch={() => search(text, "enter")} onScope={next => choose(next)} onRecent={pick}
            onOpen={href => leave(() => details.open(href))} onPlayStation={station => leave(() => void shell.enqueueRadio(station, true))}
            onPlayLink={() => leave(() => { void run({ type: "enqueueWeb", entryId: createId(), url: text, quality: videoQualityPreference?.quality ?? "auto", playNow: true }); setDraft(current => ({ ...current, value: "" })); input.current?.blur(); })} />
          : <Empty scope={scope} recents={recents} onScope={next => choose(next)} onRecent={pick} onOpen={href => leave(() => details.open(href))} />}
      </CommandList>}
    </Command>
    {/* A phone has no Esc: Cancel closes the open palette. */}
    {open && <Button type="button" variant="ghost" className="hidden shrink-0 touch:inline-flex tv:hidden" onPointerDown={event => event.preventDefault()} onClick={close}>Cancel</Button>}
  </form>;
}

/**
 * The field itself: a combobox over the palette's rows while it is open, and a plain field while closed so a remote's
 * arrows leave it. The focus stays here; the palette's selected row is its active descendant.
 */
function PaletteInput({ open, ref, ...props }: ComponentProps<typeof InputGroupInput> & { open: boolean }) {
  // The selected row by its value: cmdk's own id lags a controlled selection.
  const value = useCommandState(state => state.value);
  const [ids, setIds] = useState<{ list?: string; active?: string }>({});
  useLayoutEffect(() => {
    const list = open ? document.querySelector<HTMLElement>("[cmdk-list]") : null;
    const next = { list: list?.id, active: list?.querySelector<HTMLElement>(`[cmdk-item][data-value="${CSS.escape(value)}"]`)?.id };
    setIds(current => current.list === next.list && current.active === next.active ? current : next);
  });
  return <InputGroupInput ref={ref} role="combobox" aria-expanded={open} aria-autocomplete="list" aria-controls={ids.list} aria-activedescendant={ids.active} {...props} />;
}

/** The kinds and sources as rows, the chosen ones checked; choosing one again removes it. */
function ScopeRows({ items, scope, onScope, hint }: { items: Scope[]; scope: SearchScope; onScope: (scope: Scope) => void; hint?: Scope }) {
  return items.map(item => <CommandItem key={item.label} value={`scope:${item.label}`} data-checked={isChosen(scope, item)} onSelect={() => onScope(item)}>
    <span className="truncate">{item.label}</span>
    {hint === item && <Kbd aria-hidden="true" className="ml-auto pointer-coarse:hidden tv:hidden">Tab</Kbd>}
  </CommandItem>);
}

/** A title the client already holds: its artwork, then the title over where it comes from. */
function TitleRow({ value, title, detail, thumbnail, onSelect }: { value: string; title: string; detail?: string; thumbnail?: string; onSelect: () => void }) {
  return <CommandItem value={value} onSelect={onSelect}>
    <MediaArtwork thumbnail={thumbnail} title={title} className="aspect-square size-8 shrink-0 object-cover tv:size-10" />
    <span className="grid min-w-0 flex-1"><span className="truncate">{title}</span>{detail && <span className="truncate text-xs text-muted-foreground tv:text-sm">{detail}</span>}</span>
  </CommandItem>;
}

// The cached lists the palette draws on; each is read from the client's cache and never fetched from here.
function useHeld() {
  const { credentials } = useSessionGate();
  const { recentRadio } = useShell();
  const api = credentials ?? { origin: "", token: "" };
  const held = { enabled: false } as const;
  const later = useQuery({ ...forLaterQuery(api), ...held }).data?.items ?? [];
  const kept = useQuery({ ...providerFavoritesQuery(api), ...held }).data?.favorites ?? [];
  const played = useQuery({ ...historyQuery(api), ...held }).data?.items ?? [];
  const stations = useQuery({ ...radioFavoritesListQuery(api), ...held }).data?.favorites ?? [];
  const catalogue = useQuery({ ...radioSearchQuery(api, "avoid radio", ""), ...held }).data?.stations ?? [];
  return {
    saved: [
      ...later.map(item => ({ title: item.title, context: [item.collection?.parent?.title, item.collection?.title, item.creator?.title].filter(Boolean).join(" "), source: sourceOf(item.url), thumbnail: item.thumbnail, href: itemLocation("saved", item.id), key: `saved:${item.id}` })),
      ...kept.map(item => ({ title: item.title, context: "", source: providerNames[item.provider], thumbnail: item.thumbnail, href: collectionLocation(item), key: `kept:${item.id}` })),
    ],
    played: played.map(item => ({ title: item.title, context: [item.collection?.parent?.title, item.collection?.title, item.creator?.title].filter(Boolean).join(" "), source: item.sourceLabel ?? sourceOf(item.url), thumbnail: item.thumbnail, href: itemLocation("history", item.mediaId), key: `played:${item.mediaId}` })),
    stations: [...recentRadio ?? [], ...stations, ...catalogue] as RadioStation[],
  };
}

/**
 * The empty palette: the kinds to search in, then recent searches and what was played. One column under the field (the
 * kinds a line of chips); on the TV, columns the arrows cross.
 */
function Empty({ scope, recents, onScope, onRecent, onOpen }: { scope: SearchScope; recents: string[]; onScope: (scope: Scope) => void; onRecent: (query: string) => void; onOpen: (href: string) => void }) {
  const { played } = useHeld();
  const recent = recents.slice(0, 6), continuing = played.slice(0, 6);
  const chips = "**:[[cmdk-group-items]]:flex **:[[cmdk-group-items]]:flex-wrap **:[[cmdk-group-items]]:gap-1.5 **:[[cmdk-group-items]]:px-2 **:[[cmdk-group-items]]:pb-1 **:[[cmdk-item]]:bg-muted **:[[cmdk-item]]:px-3 **:[[cmdk-item]]:data-[checked=true]:bg-foreground **:[[cmdk-item]]:data-[checked=true]:text-background tv:**:[[cmdk-group-items]]:block tv:**:[[cmdk-group-items]]:px-0 tv:**:[[cmdk-item]]:px-2 tv:**:[[cmdk-item]]:data-[selected=false]:bg-transparent tv:**:[[cmdk-item]]:data-[selected=false]:text-foreground";
  return <div className="grid gap-y-2 tv:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] tv:gap-x-8">
    <div data-palette-column data-palette-kinds className={chips}><CommandGroup heading="Search in"><ScopeRows items={kindScopes} scope={scope} onScope={onScope} /></CommandGroup></div>
    {(recent.length > 0 || continuing.length > 0) && <div data-palette-column className="grid content-start gap-2">
      {recent.length > 0 && <CommandGroup heading="Recent searches" data-search-recents>{recent.map(query => <CommandItem key={query} value={`recent:${query}`} onSelect={() => onRecent(query)}><span className="truncate">{query}</span></CommandItem>)}</CommandGroup>}
      {continuing.length > 0 && <CommandGroup heading="Continue">{continuing.map(item => <TitleRow key={item.key} value={`continue:${item.key}`} title={item.title} detail={item.context || item.source} thumbnail={item.thumbnail} onSelect={() => onOpen(item.href)} />)}</CommandGroup>}
    </div>}
  </div>;
}

/** While typing: the query first, then the scopes it names and what the client holds that matches, never a source's search. */
function Typed({ text, link, scope, labels, recents, connected, onSearch, onScope, onRecent, onOpen, onPlayStation, onPlayLink }: {
  text: string; link: boolean; scope: SearchScope; labels: string[]; recents: string[]; connected: boolean;
  onSearch: () => void; onScope: (scope: Scope) => void; onRecent: (query: string) => void; onOpen: (href: string) => void; onPlayStation: (station: RadioStation) => void; onPlayLink: () => void;
}) {
  const held = useHeld();
  // Suggestions follow the typing once it pauses; the query row follows every key.
  const [settled] = useDebouncedValue(text, { wait: 120 });
  const found = suggest(settled, scope, { recents, saved: held.saved, played: held.played, stations: held.stations });
  if (link) {
    const provider = providerForUrl(text);
    const where = text.replace(/^https?:\/\//i, "");
    return <CommandGroup>
      <CommandItem value="link:play" disabled={!connected} onSelect={onPlayLink} className="text-base font-medium tv:min-h-14! tv:text-2xl! tv:tracking-tight"><span className="shrink-0">Play</span><span className="min-w-0 truncate font-normal text-muted-foreground">{where}</span></CommandItem>
      {provider && <CommandItem value="link:open" onSelect={() => onOpen(collectionLocation({ provider, url: text }))}>Open page</CommandItem>}
      <CommandItem value="query" onSelect={onSearch}>Choose how to play</CommandItem>
    </CommandGroup>;
  }
  return <>
    <CommandGroup>
      {/* On the TV the typed query reads from the sofa here, larger than the header's field holds it. */}
      <CommandItem value="query" onSelect={onSearch} className="text-base font-medium tv:min-h-14! tv:text-2xl! tv:tracking-tight">
        <Search aria-hidden="true" className="text-muted-foreground tv:size-6" /><span className="sr-only">Search </span><span className="min-w-0 truncate">{text}</span>
        {labels.length > 0 && <span className="shrink-0 font-normal text-muted-foreground">in {labels.join(", ")}</span>}
      </CommandItem>
    </CommandGroup>
    {found.scopes.length > 0 && <CommandGroup heading="Search in"><ScopeRows items={found.scopes} scope={scope} onScope={onScope} hint={found.scopes[0]} /></CommandGroup>}
    {found.recents.length > 0 && <CommandGroup heading="Recent searches" data-search-recents>{found.recents.map(query => <CommandItem key={query} value={`recent:${query}`} onSelect={() => onRecent(query)}><span className="truncate">{query}</span></CommandItem>)}</CommandGroup>}
    {found.saved.length > 0 && <CommandGroup heading="Saved">{found.saved.map(item => <TitleRow key={item.key} value={item.key} title={item.title} detail={item.context || item.source} thumbnail={item.thumbnail} onSelect={() => onOpen(item.href)} />)}</CommandGroup>}
    {found.played.length > 0 && <CommandGroup heading="Played">{found.played.map(item => <TitleRow key={item.key} value={item.key} title={item.title} detail={item.context || item.source} thumbnail={item.thumbnail} onSelect={() => onOpen(item.href)} />)}</CommandGroup>}
    {found.stations.length > 0 && <CommandGroup heading="Stations">{found.stations.map(station => <TitleRow key={station.id} value={`station:${station.id}`} title={station.name} detail={station.groupTitle ?? kindLabels.radio} thumbnail={station.logoUrl} onSelect={() => onPlayStation(station)} />)}</CommandGroup>}
  </>;
}
