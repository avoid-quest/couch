import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import { useLocation, useRouter } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useIsFetching } from "@tanstack/react-query";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { focusPageControl } from "@/navigation";
import { isLink, readSearchState, searchLocation } from "@/search";
import { isTvPresentation } from "@/session/presentation";
import { useSessionGate } from "@/session/session-context";
import { useShell } from "@/sections/shell/shell-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { readSearchRecents, rememberSearch } from "./search-recents";

/**
 * The header's search field, on every page. Typing searches once it pauses for half a second (Enter at once) on the
 * results page, /search?q=…, and an empty query is Discover. Empty and focused, it offers the last queries typed into
 * it; a source can scope it (Discover's YouTube, Bandcamp and SoundCloud), and Enter on results plays the closest
 * match when that is a station or a live stream. It is the TV's Search field too, which a phone's Remote types into
 * (Type on TV), and `/` focuses it.
 */
export function HeaderSearch({ className }: { className?: string }) {
  const router = useRouter();
  const { pathname, searchStr } = useLocation();
  const { connected, credentials } = useSessionGate();
  const shell = useShell();
  const installationId = credentials?.installationId ?? "";
  const results = pathname === "/search";
  const route = results ? readSearchState(searchStr) : null;
  const routeQuery = route?.query ?? "";
  // The typed query follows the route (the results' query, else empty) until the next edit.
  const routeKey = pathname + searchStr;
  const [draft, setDraft] = useState({ route: routeKey, value: routeQuery });
  if (draft.route !== routeKey) setDraft({ route: routeKey, value: routeQuery });
  const value = draft.value;
  // The field spins while a typed query waits, then while the results page's sources answer.
  const fetching = useIsFetching({ queryKey: ["search", "providers"] });
  const type = (next: string) => setDraft(current => ({ ...current, value: next }));
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  // The scope a source gave the field, until the results carry it; the results' own source thereafter.
  const scope = results ? route?.source ?? "All" : shell.searchScope ?? "All";
  useEffect(() => { if (results) shell.setSearchScope(null); }, [results]);
  const [recents, setRecents] = useState<string[]>([]);
  useEffect(() => { setRecents(installationId ? readSearchRecents(installationId) : []); }, [installationId]);
  const [focused, setFocused] = useState(false);
  const search = (query: string, submit = false) => {
    if (!query && !results) return;
    const href = query ? searchLocation({ ...route ?? { source: scope }, query, ...isLink(query) ? { source: "All" } : {} }) : "/discover";
    if (query && !isLink(query) && installationId) setRecents(rememberSearch(installationId, query));
    // A pasted query's results open in place; Enter goes on to them, while typing keeps focus here (on the TV too).
    if (href !== pathname + searchStr) void router.navigate({ href, replace: results, ...submit ? {} : { state: { detailFocus: { selector: "#media-search", index: 0 } } } });
    else if (submit) {
      // Enter on results plays the closest match when its press plays (a station, a live stream); otherwise it goes to it.
      const first = document.querySelector<HTMLElement>("[data-page] [data-page-first]");
      if (first?.closest("[data-search-top]") && first.textContent?.startsWith("Play")) first.click();
      else first?.focus();
    }
  };
  // One query fills every one of Core's provider slots (including two yt-dlp jobs), so typing searches once it pauses;
  // Enter and a recent query search at once and drop what was pending.
  const debouncer = useDebouncer((query: string) => search(query), { wait: 500, enabled: connected }, state => ({ isPending: state.isPending }));
  // The header survives navigation; drafts belong to the location and provider where they were typed.
  const { cancel } = debouncer;
  useLayoutEffect(() => { cancel(); }, [cancel, routeKey, shell.searchScope, installationId]);
  const busy = connected && (debouncer.state.isPending || results && fetching > 0);
  const edit = (next: string) => { type(next); if (!composing.current && next.trim() !== routeQuery) debouncer.maybeExecute(next.trim()); else debouncer.cancel(); };
  const pick = (query: string) => { debouncer.cancel(); type(query); search(query, true); };
  // On the results page, typing anywhere outside a control goes on with the query.
  const typeToSearch = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1 || event.key === " " || document.querySelector('[role="dialog"][data-state="open"]')) return;
    if (!(event.target instanceof HTMLElement) || event.target.closest("button, a, input, select, textarea, summary, [role=button], [role=link], [role=option], [contenteditable=true]")) return;
    input.current?.focus();
    edit(`${value}${event.key}`);
    event.preventDefault();
  });
  useEffect(() => {
    if (!results) return;
    const onKeyDown = (event: KeyboardEvent) => typeToSearch(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [results]);
  const clear = () => { debouncer.cancel(); type(""); shell.setSearchScope(null); search(""); input.current?.focus(); };
  const recentsShown = focused && !value && recents.length > 0;
  return <form role="search" aria-label="Search" aria-busy={busy} className={cn("relative", className)} onSubmit={event => { event.preventDefault(); if (!composing.current) { debouncer.cancel(); search(value.trim(), true); } }}
    onFocus={() => setFocused(true)} onBlur={event => { if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setFocused(false); }}>
    {/* InputGroup keeps its input/addon behavior; the header needs a hairline and Clock inversion instead of a box. */}
    <InputGroup className="h-11 rounded-none border-x-0 border-t-0 border-b bg-transparent transition-colors dark:bg-transparent has-[input:focus]:border-foreground has-[input:focus]:bg-foreground has-[input:focus]:text-background has-[input:focus]:duration-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0">
      <InputGroupAddon className="pl-2.5 group-has-[input:focus]/input-group:text-background/65">{busy ? <Spinner aria-hidden="true" /> : <Search aria-hidden="true" />}</InputGroupAddon>
      <InputGroupInput ref={input} id="media-search" data-remote-field="find" type="search" aria-label="Search or paste a link" placeholder={scope === "All" ? "Search" : `Search ${scope}`} maxLength={4096} autoComplete="off" className="h-full text-base md:text-base caret-current focus:duration-0 focus-visible:outline-none group-has-[input:focus]/input-group:placeholder:text-background/65 [&::-webkit-search-cancel-button]:hidden" value={value}
        onChange={event => edit(event.target.value)}
        onCompositionStart={() => { composing.current = true; debouncer.cancel(); }} onCompositionEnd={event => { composing.current = false; edit(event.currentTarget.value); }}
        onKeyDown={event => {
          if (event.key === "Enter" && (event.nativeEvent.isComposing || composing.current || event.nativeEvent.keyCode === 229)) event.preventDefault();
          // Off the TV, Esc clears the field, then leaves it; the TV's Back stays Back.
          else if (event.key === "Escape" && !isTvPresentation()) { event.preventDefault(); if (value) clear(); else { shell.setSearchScope(null); input.current?.blur(); } }
          // Down reaches the recent searches while they show, else goes on to the page, as it does from the header's tabs.
          else if (event.key === "ArrowDown") {
            const recent = event.currentTarget.form?.querySelector<HTMLElement>("[data-search-recents] button");
            if (recent) { event.preventDefault(); recent.focus(); return; }
            const page = document.querySelector<HTMLElement>("[data-page]");
            if (page) { event.preventDefault(); focusPageControl(page); }
          }
        }} />
      {!value && <InputGroupAddon align="inline-end" className="hidden pointer-fine:flex group-has-[input:focus]/input-group:invisible tv:hidden"><Kbd aria-hidden="true">/</Kbd></InputGroupAddon>}
      {value && <InputGroupAddon align="inline-end" className="pr-2.5 group-has-[input:focus]/input-group:text-background/65"><InputGroupButton size="icon-xs" className="touch:size-11" aria-label="Clear search" onClick={clear}><X aria-hidden="true" /></InputGroupButton></InputGroupAddon>}
    </InputGroup>
    {/* The last queries, as divided rows under the field while it is empty and focused; Down walks them, Up returns. */}
    {/* A press keeps the field focused (a tap or a Safari click would blur it first and take the list away), and Esc returns to it. */}
    {recentsShown && <ul data-search-recents aria-label="Recent searches" className="absolute inset-x-0 top-full z-30 grid divide-y border-b bg-background" onPointerDown={event => event.preventDefault()} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); input.current?.focus(); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("button")], at = buttons.indexOf(event.target as HTMLElement);
      const next = event.key === "ArrowDown" ? buttons[at + 1] : at > 0 ? buttons[at - 1] : input.current;
      if (next) { event.preventDefault(); next.focus(); }
    }}>
      {recents.map(query => <li key={query}><Button type="button" variant="ghost" className="h-11 w-full justify-start truncate rounded-none px-2.5 font-normal" onClick={() => pick(query)}>{query}</Button></li>)}
    </ul>}
  </form>;
}
