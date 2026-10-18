import { useEffect, useEffectEvent, useRef, useState } from "react";
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

/**
 * The header's search field, on every page. Typing searches after a second (Enter at once) on the results page,
 * /search?q=…, and an empty query is Discover. It is the TV's Search field too, which a phone's Remote types into
 * (Type on TV), and `/` focuses it.
 */
export function HeaderSearch({ className }: { className?: string }) {
  const router = useRouter();
  const { pathname, searchStr } = useLocation();
  const { connected } = useSessionGate();
  const results = pathname === "/search";
  const route = results ? readSearchState(searchStr) : null;
  const routeQuery = route?.query ?? "";
  // The typed query follows the route (the results' query, else empty) until the next edit.
  const [draft, setDraft] = useState({ route: routeQuery, value: routeQuery });
  if (draft.route !== routeQuery) setDraft({ route: routeQuery, value: routeQuery });
  const value = draft.value;
  // The field spins while a typed query waits, then while the results page's sources answer.
  const fetching = useIsFetching({ queryKey: ["search", "providers"] });
  const busy = connected && (value.trim() !== routeQuery || results && fetching > 0);
  const type = (next: string) => setDraft(current => ({ ...current, value: next }));
  const [composing, setComposing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const search = (query: string, submit = false) => {
    if (!query && !results) return;
    const href = query ? searchLocation({ ...route ?? { source: "All" }, query, ...isLink(query) ? { source: "All" } : {} }) : "/discover";
    // A pasted query's results open in place; Enter goes on to them, while typing keeps focus here (on the TV too).
    if (href !== pathname + searchStr) void router.navigate({ href, replace: results, ...submit ? {} : { state: { detailFocus: { selector: "#media-search", index: 0 } } } });
    else if (submit) document.querySelector<HTMLElement>("[data-page] [data-page-first]")?.focus();
  };
  const commit = useEffectEvent(() => search(value.trim()));
  useEffect(() => {
    if (composing || !connected || value.trim() === routeQuery) return;
    // One query fills every one of Core's provider slots (including two yt-dlp jobs); keep edits coalesced.
    const timer = setTimeout(commit, 1000);
    return () => clearTimeout(timer);
  }, [value, routeQuery, composing, connected]);
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
  const clear = () => { type(""); search(""); input.current?.focus(); };
  return <form role="search" aria-label="Search" aria-busy={busy} className={className} onSubmit={event => { event.preventDefault(); if (!composing) search(value.trim(), true); }}>
    {/* InputGroup keeps its input/addon behavior; the header needs a hairline and Clock inversion instead of a box. */}
    <InputGroup className="h-11 rounded-none border-x-0 border-t-0 border-b bg-transparent transition-colors dark:bg-transparent has-[input:focus]:border-foreground has-[input:focus]:bg-foreground has-[input:focus]:text-background has-[input:focus]:duration-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0">
      <InputGroupAddon className="pl-2.5 group-has-[input:focus]/input-group:text-background/65">{busy ? <Spinner aria-hidden="true" /> : <Search aria-hidden="true" />}</InputGroupAddon>
      <InputGroupInput ref={input} id="media-search" data-remote-field="find" type="search" aria-label="Search or paste a link" placeholder="Search" maxLength={4096} autoComplete="off" className="h-full text-base md:text-base caret-current focus:duration-0 focus-visible:outline-none group-has-[input:focus]/input-group:placeholder:text-background/65 [&::-webkit-search-cancel-button]:hidden" value={value}
        onChange={event => type(event.target.value)}
        onCompositionStart={() => setComposing(true)} onCompositionEnd={event => { setComposing(false); type(event.currentTarget.value); }}
        onKeyDown={event => {
          if (event.key === "Enter" && (event.nativeEvent.isComposing || composing)) event.preventDefault();
          // Off the TV, Esc clears the field, then leaves it; the TV's Back stays Back.
          else if (event.key === "Escape" && !isTvPresentation()) { event.preventDefault(); if (value) clear(); else input.current?.blur(); }
          // Down goes on to the page, as it does from the header's tabs.
          else if (event.key === "ArrowDown") {
            const page = document.querySelector<HTMLElement>("[data-page]");
            if (page) { event.preventDefault(); focusPageControl(page); }
          }
        }} />
      {!value && <InputGroupAddon align="inline-end" className="hidden pointer-fine:flex group-has-[input:focus]/input-group:invisible tv:hidden"><Kbd aria-hidden="true">/</Kbd></InputGroupAddon>}
      {value && <InputGroupAddon align="inline-end" className="pr-2.5 group-has-[input:focus]/input-group:text-background/65"><InputGroupButton size="icon-xs" className="touch:size-11" aria-label="Clear search" onClick={clear}><X aria-hidden="true" /></InputGroupButton></InputGroupAddon>}
    </InputGroup>
  </form>;
}
