import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from "react";
import { useLocation, useRouter } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useIsFetching, useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useCommandState } from "cmdk";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { focusPageControl } from "@/navigation";
import { isLink, linkOf, readSearchState, searchLocation } from "@/search";
import {
  chipScopes,
  chooseScope,
  completeScope,
  dropScope,
  hasScope,
  isChosen,
  kindLabels,
  scopeLabels,
  suggest,
  type Scope,
  type SearchScope,
} from "@/search-palette";
import { ScopeChips } from "@/sections/find/ScopeChips";
import { isTvPresentation } from "@/session/presentation";
import { useSessionGate } from "@/session/session-context";
import { useShell } from "@/sections/shell/shell-context";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { collectionLocation, itemLocation, useDetailNavigation } from "@/detail-navigation";
import { forLaterQuery } from "@/api/for-later";
import { historyQuery } from "@/api/progress";
import { providerFavoritesQuery } from "@/api/providers";
import { radioFavoritesListQuery, radioSearchQuery } from "@/api/radio";
import { cn } from "@/lib/utils";
import { metaLine } from "@/media-caption";
import { linkTarget, providerForUrl, providerNames } from "../../../shared/providers";
import { linkAction, useListCommand, type LinkVerb } from "@/pasted-link";
import type { RadioStation } from "../../../shared/radio";
import { readSearchRecents, rememberSearch } from "./search-recents";
import { Skeleton } from "@/components/ui/skeleton";
import { HitRow, PaletteFoot, TopHero, rowMenu, usePaletteHits } from "./PaletteResults";
import { PaletteLink } from "./PaletteLink";
import type { SearchHit } from "@/sections/find/SearchOnlineResults";

/** What a typed palette's rows answer to besides Enter: Shift+Enter queues, → opens a row's menu and ← closes it. */
type RowKeys = {
  queue: (value: string) => boolean;
  menu: (value: string, open: boolean) => boolean;
  hint: (value: string) => { enter: string; queue?: string; menu: boolean } | undefined;
};

const none = "none";
const sourceOf = (url?: string) => {
  const provider = url ? providerForUrl(url) : undefined;
  return provider && providerNames[provider];
};

/**
 * The header's search field, on every page, as a command palette (shadcn Command). Focused, it lists the kinds to search
 * in, recent searches and what was played; typing suggests only what the client already holds.
 * A scope becomes a token in the field (pick it, or type its name and Tab; Backspace removes it), and on the results
 * page the token is the page's kind and source, both ways. Enter on the query opens /search?q=…&kind=…&source=…; Enter on
 * a suggestion opens it, or plays a station or a pasted link. An empty query is Home. It is the TV's Search field
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
  const url = linkOf(text);
  const link = !!url;
  const listCommand = useListCommand(run);
  // The field spins only while the submitted query's sources answer.
  const fetching = useIsFetching({ queryKey: ["search", "providers"] });
  const [open, setOpen] = useState(false);
  // The palette's selected row: a pasted link's Play, else the query; none while the field is empty (Enter then submits).
  const [selected, setSelected] = useState(none);
  // Whether the keys or the pointer moved the selection since the last edit; until they do, the top row takes it.
  const moved = useRef(false);
  const rowKeys = useRef<RowKeys | null>(null);
  // A pasted list opens on Play all, a page (a channel, a series) on Open, anything else on Play.
  const first = (next: string) => {
    const pasted = linkOf(next.trim());
    if (!next.trim()) return none;
    if (!pasted || !connected) return "query";
    return linkTarget(pasted)?.shape === "page" ? "link:open" : "link:play";
  };
  const type = (next: string) => {
    // An edit that only adds or removes spaces keeps what's chosen; any other edit hands the selection back to the top row.
    if (next.trim() !== value.trim() || !next.trim()) {
      moved.current = false;
      setSelected(first(next));
    }
    setDraft((current) => ({ ...current, value: next }));
    setOpen(true);
  };
  const show = () => {
    setSelected(first(value));
    setOpen(true);
  };
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  // The scope is the results' kind and source; elsewhere, what a source or the palette gave the field until the results carry it.
  const scope: SearchScope = route
    ? { kind: route.kind, source: route.source }
    : (shell.searchScope ?? { source: "All" });
  const rescope = (next: SearchScope) =>
    route
      ? shell.changeSearch({ ...route, kind: next.kind, source: next.source })
      : shell.setSearchScope(hasScope(next) ? next : null);
  useEffect(() => {
    if (results) shell.setSearchScope(null);
  }, [results]);
  // A source that scopes the field (Home's YouTube) opens it, on the TV too.
  useEffect(() => {
    if (shell.searchScope && !open && document.activeElement === input.current) show();
  }, [shell.searchScope]);
  // The palette belongs to the focused field: a page that changes under it closes it, and so does the player, which hides
  // the header without blurring the field (a played link, or a picture opening it by itself).
  useEffect(() => {
    if (pathname === "/now" || document.activeElement !== input.current) setOpen(false);
  }, [pathname]);
  const [recents, setRecents] = useState<string[]>([]);
  useEffect(() => {
    setRecents(installationId ? readSearchRecents(installationId) : []);
  }, [installationId]);
  const search = (query: string, action: "clear" | "submit" | "enter" = "clear") => {
    if (!query && !results) return;
    const href = query
      ? searchLocation({ query, ...(isLink(query) ? { source: "All" } : scope) })
      : "/";
    if (query && !isLink(query) && installationId)
      setRecents(rememberSearch(installationId, query));
    if (action !== "clear") setOpen(false);
    // Submission goes on to the results; clearing keeps focus here (on the TV too).
    if (href !== pathname + searchStr)
      void router.navigate({
        href,
        replace: results,
        ...(action !== "clear"
          ? {}
          : { state: { detailFocus: { selector: "#media-search", index: 0 } } }),
      });
    else if (action !== "clear") {
      // Enter on results plays the closest match when its press plays (a station, a live stream); otherwise it goes to it.
      const first = document.querySelector<HTMLElement>("[data-page] [data-page-first]");
      if (
        action === "enter" &&
        first?.closest("[data-search-top]") &&
        first.textContent?.startsWith("Play")
      )
        first.click();
      else first?.focus();
    }
  };
  const busy = connected && results && fetching > 0;
  const pick = (query: string) => {
    type(query);
    search(query, "submit");
  };
  const choose = (next: Scope, completing = false) => {
    rescope(completing && isChosen(scope, next) ? scope : chooseScope(scope, next));
    if (text && completeScope(text) === next) type("");
  };
  const leave = (then: () => void) => {
    setOpen(false);
    then();
  };
  // On the results page, typing anywhere outside a control goes on with the query.
  const typeToSearch = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.key.length !== 1 ||
      event.key === " " ||
      document.querySelector('[role="dialog"][data-state="open"]')
    )
      return;
    if (
      !(event.target instanceof HTMLElement) ||
      event.target.closest(
        "button, a, input, select, textarea, summary, [role=button], [role=link], [role=option], [contenteditable=true]",
      )
    )
      return;
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
  const clear = () => {
    type("");
    shell.setSearchScope(null);
    search("");
    input.current?.focus();
  };
  const close = () => {
    setOpen(false);
    input.current?.blur();
  };
  // Left and Right move between the TV's columns in the empty palette.
  const list = useRef<HTMLDivElement>(null);
  const across = (step: number) => {
    const columns = [
      ...(list.current?.querySelectorAll<HTMLElement>("[data-palette-column]") ?? []),
    ].filter((column) => column.querySelector("[cmdk-item]"));
    const items = (column?: HTMLElement) => [
      ...(column?.querySelectorAll<HTMLElement>('[cmdk-item]:not([aria-disabled="true"])') ?? []),
    ];
    const at = columns.findIndex((column) =>
      column.querySelector('[cmdk-item][aria-selected="true"]'),
    );
    const row = items(columns[at]).findIndex(
      (item) => item.getAttribute("aria-selected") === "true",
    );
    const next = items(columns[at + step]).at(Math.min(row, items(columns[at + step]).length - 1));
    if (at < 0 || !next) return false;
    setSelected(next.getAttribute("data-value")!);
    return true;
  };
  // A pasted link's first verb can come later (a station's Play, once Couch finds the station): until it shows, the
  // first row that does takes the selection, so Enter always does something; it comes back unless the keys or pointer
  // moved the selection.
  useLayoutEffect(() => {
    if (!open || !link || moved.current) return;
    const preferred = first(value);
    const next = list.current?.querySelector(`[cmdk-item][data-value="${CSS.escape(preferred)}"]`)
      ? preferred
      : list.current?.querySelector<HTMLElement>("[cmdk-item]")?.dataset.value;
    if (next && next !== selected) setSelected(next);
  });
  // The chips and the TV hero's verbs are lines: Left and Right move along one, Up and Down leave it, and a line is entered
  // on its chosen chip, else its first.
  const line = (key: string) => {
    const items = [
      ...(list.current?.querySelectorAll<HTMLElement>('[cmdk-item]:not([aria-disabled="true"])') ??
        []),
    ];
    const values = items.map((item) => item.dataset.value!);
    const lineOf = (value?: string) =>
      ["chip:", "top:"].find((prefix) => value?.startsWith(prefix));
    const enter = (value?: string) => {
      const prefix = lineOf(value);
      const members = items.filter((item) => prefix && item.dataset.value!.startsWith(prefix));
      const landing = members.find((item) => item.dataset.checked === "true") ?? members[0];
      return landing ? landing.dataset.value : value;
    };
    const at = values.indexOf(selected);
    const own = lineOf(selected);
    const members = own ? values.filter((value) => value.startsWith(own)) : [];
    let next: string | undefined;
    if (own && (key === "ArrowLeft" || key === "ArrowRight"))
      next = members[members.indexOf(selected) + (key === "ArrowLeft" ? -1 : 1)] ?? selected;
    else if (own && key === "ArrowDown")
      next = enter(values.slice(at + 1).find((value) => !value.startsWith(own))) ?? selected;
    else if (own && key === "ArrowUp")
      next = enter(values.slice(0, at).findLast((value) => !value.startsWith(own))) ?? selected;
    else if (key === "ArrowUp" && lineOf(values[at - 1])) next = enter(values[at - 1]);
    else if (key === "ArrowDown" && lineOf(values[at + 1])) next = enter(values[at + 1]);
    if (!next) return false;
    setSelected(next);
    return true;
  };
  // A link plays as itself, outside any scope.
  const labels = link ? [] : scopeLabels(scope);
  const tokens = useId();
  return (
    <form
      role="search"
      aria-label="Search"
      aria-busy={busy}
      data-search-open={open || undefined}
      data-search-filled={!!(value || labels.length) || undefined}
      className={cn("flex min-w-0 items-center gap-1", className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!composing.current)
          search(text, (event.nativeEvent as SubmitEvent).submitter ? "submit" : "enter");
      }}
      onFocus={(event) => {
        if ((event.target as Node) === input.current && !open && !isTvPresentation()) show();
      }}
      onBlur={(event) => {
        if (
          !(
            event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
          )
        )
          setOpen(false);
      }}
    >
      <Command
        label="Search or paste a link"
        shouldFilter={false}
        loop={false}
        vimBindings={false}
        value={selected}
        onValueChange={setSelected}
        className="relative min-w-0 flex-1"
      >
        {/* InputGroup keeps its input/addon behavior; the header gives search a quiet filled surface. Focused, it inverts
          at once; while the palette is open its selected row is the one white thing, so the field takes a white edge instead. */}
        <InputGroup
          className={cn(
            "h-field rounded-full border-transparent bg-muted transition-colors dark:bg-muted has-[[data-slot=input-group-control]:focus-visible]:ring-0",
            open
              ? "border-foreground"
              : "has-[input:focus]:border-foreground has-[input:focus]:bg-foreground has-[input:focus]:text-background has-[input:focus]:duration-0",
          )}
        >
          <InputGroupAddon
            className={cn(
              "min-w-0 shrink pl-3",
              !open && "group-has-[input:focus]/input-group:text-background/65",
            )}
          >
            <InputGroupButton
              type="submit"
              size="icon-sm"
              className="shrink-0 max-sm:hidden touch:size-11 [&_svg]:size-5!"
              aria-label="Search"
              title="Search"
            >
              {busy ? <Spinner aria-hidden="true" /> : <Search aria-hidden="true" />}
            </InputGroupButton>
            {!value && !labels.length && (
              <Search aria-hidden="true" className="hidden size-5 shrink-0 max-sm:block" />
            )}
            {/* The scope's tokens: a press removes one (the keyboard's Backspace, the TV's own row in the palette). */}
            <div
              data-search-tokens
              className="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] empty:hidden"
            >
              {labels.map((label) => (
                <button
                  key={label}
                  type="button"
                  tabIndex={-1}
                  data-search-token
                  aria-label={`Remove ${label}`}
                  title={`Remove ${label}`}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    rescope(
                      label === scope.source
                        ? { kind: scope.kind, source: "All" }
                        : { source: scope.source },
                    );
                    input.current?.focus();
                  }}
                  className={cn(
                    "min-w-8 max-w-32 truncate rounded-full bg-foreground/15 px-2.5 py-0.5 text-sm font-medium text-foreground",
                    !open &&
                      "group-has-[input:focus]/input-group:bg-background/15 group-has-[input:focus]/input-group:text-background",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </InputGroupAddon>
          <span id={tokens} hidden>
            {labels.length ? `In ${labels.join(", ")}` : ""}
          </span>
          <PaletteInput
            ref={input}
            open={open}
            id="media-search"
            data-remote-field="find"
            type="search"
            aria-label="Search or paste a link"
            aria-describedby={labels.length ? tokens : undefined}
            placeholder="Search"
            maxLength={4096}
            autoComplete="off"
            className={cn(
              "h-full min-w-16 text-title md:text-title caret-current focus:duration-0 focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden",
              !open && "group-has-[input:focus]/input-group:placeholder:text-background/65",
            )}
            value={value}
            onChange={(event) => type(event.target.value)}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              type(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              // While an IME composes, its keys finish the text: Enter (Shift+Enter too) never submits or queues.
              if (
                event.nativeEvent.isComposing ||
                composing.current ||
                event.nativeEvent.keyCode === 229
              ) {
                if (event.key === "Enter") event.preventDefault();
                return;
              }
              // The keys take the palette's selection back from the pointer (index.css: cmdk).
              list.current?.removeAttribute("data-pointer");
              const plain = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
              if (event.key.startsWith("Arrow")) moved.current = true;
              const rows = open && text && !link ? rowKeys.current : null;
              const atEnd = event.currentTarget.selectionStart === value.length;
              // The TV hero's Left and Right move along its verbs; its menu is its "…".
              const onHero = selected.startsWith("top:");
              if (
                (rows &&
                  ((event.key === "Enter" && event.shiftKey && rows.queue(selected)) ||
                    (plain &&
                      event.key === "ArrowRight" &&
                      atEnd &&
                      !onHero &&
                      rows.menu(selected, true)) ||
                    (plain &&
                      ((event.key === "ArrowLeft" && !onHero) || event.key === "Escape") &&
                      rows.menu(selected, false)))) ||
                (open && !link && plain && event.key.startsWith("Arrow") && line(event.key))
              ) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              // cmdk consumes modified Up/Down too; keep text selection and caret shortcuts native.
              if (!plain && event.key.startsWith("Arrow")) {
                event.stopPropagation();
                return;
              }
              if (event.key === "Enter") {
                // Closed, Enter submits without the Search button, as Type on TV does; the TV's OK opens the palette instead.
                // Open, it does the selected row (the palette's own Enter), or submits while none is.
                if (!open || selected === none) {
                  event.preventDefault();
                  if (!open && isTvPresentation()) show();
                  else event.currentTarget.form?.requestSubmit();
                }
              }
              // Off the TV, Esc clears the open palette's field, then closes it and leaves; a closed palette's field (after a
              // search) it just leaves. The TV's Back closes the palette, then stays Back.
              else if (event.key === "Escape") {
                if (!isTvPresentation()) {
                  event.preventDefault();
                  if (open && value) clear();
                  else {
                    if (!results) shell.setSearchScope(null);
                    close();
                  }
                } else if (open) {
                  event.preventDefault();
                  setOpen(false);
                }
              }
              // Tab turns a scope's name into its token; Backspace in an empty field takes the last token away.
              else if (event.key === "Tab" && plain && open && !link && completeScope(text)) {
                event.preventDefault();
                choose(completeScope(text)!, true);
              } else if (event.key === "Backspace" && !value && hasScope(scope)) {
                event.preventDefault();
                rescope(dropScope(scope));
              }
              // The field keeps Home and End for its text.
              else if (event.key === "Home" || event.key === "End") event.stopPropagation();
              else if (
                open &&
                !value &&
                plain &&
                isTvPresentation() &&
                (event.key === "ArrowLeft" || event.key === "ArrowRight")
              ) {
                if (across(event.key === "ArrowLeft" ? -1 : 1)) event.preventDefault();
              }
              // Closed, Down goes on to the page, as it does from the header's tabs.
              else if (event.key === "ArrowDown" && plain && !open) {
                const page = document.querySelector<HTMLElement>("[data-page]");
                if (page) {
                  event.preventDefault();
                  focusPageControl(page);
                }
              }
            }}
          />
          {!value && !labels.length && (
            <InputGroupAddon
              align="inline-end"
              className="hidden pr-4 pointer-fine:flex touch:hidden group-has-[input:focus]/input-group:invisible tv:hidden"
            >
              <Kbd aria-hidden="true">/</Kbd>
            </InputGroupAddon>
          )}
          {(value || labels.length > 0) && (
            <InputGroupAddon
              align="inline-end"
              className={cn(
                "shrink-0 pr-3",
                !open && "group-has-[input:focus]/input-group:text-background/65",
              )}
            >
              <InputGroupButton
                size="icon-sm"
                className="touch:size-11"
                aria-label="Clear search"
                onClick={clear}
              >
                <X aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        {/* On a desktop, the field's own list: under it, its width and its left edge, on the menus' ground. On a phone and
          the TV, the whole screen under the header. A press keeps the field focused (a tap or a Safari click would blur
          it first and take the list away). */}
        {open && (
          <CommandList
            ref={list}
            label="Suggestions"
            onPointerDown={(event) => event.preventDefault()}
            onPointerMove={(event) => {
              if (event.pointerType === "mouse" && !isTvPresentation()) {
                moved.current = true;
                event.currentTarget.setAttribute("data-pointer", "");
              }
            }}
            className="absolute inset-x-0 top-full z-30 mt-2 max-h-[min(40rem,calc(100dvh-var(--top-bar,4rem)-1rem))] rounded-lg bg-popover p-2 **:[[cmdk-item]]:min-h-10 **:[[cmdk-item]]:text-body **:[[cmdk-group-heading]]:text-meta touch:fixed touch:top-(--top-bar) touch:bottom-0 touch:mt-0 touch:max-h-none touch:rounded-none touch:bg-background touch:px-[calc(var(--gutter)-0.5rem)] touch:pt-4 tv:fixed tv:top-(--top-bar) tv:bottom-0 tv:mt-0 tv:max-h-none tv:rounded-none tv:bg-background tv:px-[calc(var(--gutter)-0.5rem)] tv:py-8 tv:**:[[cmdk-item]]:min-h-10 tv:**:[[cmdk-item]]:text-base tv:**:[[cmdk-group-heading]]:text-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150"
          >
            {!link && (
              <ScopeChips
                palette
                chips={[
                  {
                    label: "All",
                    checked: !hasScope(scope),
                    onPress: () => rescope({ kind: undefined, source: "All" }),
                  },
                  ...chipScopes(scope).map((item) => ({
                    label: item.label,
                    checked: isChosen(scope, item),
                    hint: completeScope(text) === item && (
                      <Kbd aria-hidden="true" className="pointer-coarse:hidden tv:hidden">
                        Tab
                      </Kbd>
                    ),
                    onPress: () => choose(item),
                  })),
                ]}
                onMore={(label) => setSelected(`chip:${label}`)}
                className="px-0.5 pb-2 touch:sticky touch:-top-4 touch:z-10 touch:-mt-4 touch:bg-background touch:pt-4 tv:pb-6"
              />
            )}
            {text ? (
              <Typed
                text={url ?? value}
                link={link}
                scope={scope}
                labels={labels}
                recents={recents}
                connected={connected}
                selected={selected}
                moved={moved.current}
                rowKeys={rowKeys}
                onTop={(next) => {
                  if (!moved.current) setSelected(next);
                }}
                onSelectRow={setSelected}
                onRun={(run) => leave(run)}
                onSearch={() => search(text, "enter")}
                onRecent={pick}
                onOpen={(href) => leave(() => details.open(href))}
                onPlayStation={(station) => leave(() => void shell.enqueueRadio(station, true))}
                onLink={(verb, list) =>
                  leave(() => {
                    // The link stays in the field until it plays, so a failed one can be tried again; a field
                    // edited meanwhile keeps its edit.
                    const submitted = value;
                    void listCommand(
                      linkAction(
                        url!,
                        linkTarget(url!),
                        verb,
                        videoQualityPreference?.quality ?? "auto",
                        list,
                      ),
                      list,
                      url!.replace(/^https?:\/\//i, ""),
                    ).then((ok) => {
                      if (ok)
                        setDraft((current) =>
                          current.value === submitted ? { ...current, value: "" } : current,
                        );
                    });
                    input.current?.blur();
                  })
                }
              />
            ) : (
              <Empty
                recents={recents}
                onRecent={pick}
                onOpen={(href) => leave(() => details.open(href))}
              />
            )}
          </CommandList>
        )}
      </Command>
      {/* A phone has no Esc: Cancel closes the open palette. */}
      {open && (
        <Button
          type="button"
          variant="ghost"
          className="hidden shrink-0 px-1 touch:inline-flex tv:hidden"
          onPointerDown={(event) => event.preventDefault()}
          onClick={close}
        >
          Cancel
        </Button>
      )}
    </form>
  );
}

/**
 * The field itself: a combobox over the palette's rows while it is open, and a plain field while closed so a remote's
 * arrows leave it. The focus stays here; the palette's selected row is its active descendant.
 */
function PaletteInput({
  open,
  ref,
  ...props
}: ComponentProps<typeof InputGroupInput> & { open: boolean }) {
  // The selected row by its value: cmdk's own id lags a controlled selection.
  const value = useCommandState((state) => state.value);
  const [ids, setIds] = useState<{ list?: string; active?: string }>({});
  useLayoutEffect(() => {
    const list = open ? document.querySelector<HTMLElement>("[cmdk-list]") : null;
    const next = {
      list: list?.id,
      active: list?.querySelector<HTMLElement>(`[cmdk-item][data-value="${CSS.escape(value)}"]`)
        ?.id,
    };
    setIds((current) =>
      current.list === next.list && current.active === next.active ? current : next,
    );
  });
  return (
    <InputGroupInput
      ref={ref}
      role="combobox"
      aria-expanded={open}
      aria-autocomplete="list"
      aria-controls={ids.list}
      aria-activedescendant={ids.active}
      {...props}
    />
  );
}

/** A title the client already holds: its artwork, then the title over where it comes from. */
function TitleRow({
  value,
  title,
  detail,
  thumbnail,
  onSelect,
}: {
  value: string;
  title: string;
  detail?: string;
  thumbnail?: string;
  onSelect: () => void;
}) {
  return (
    <CommandItem value={value} onSelect={onSelect}>
      <MediaArtwork
        thumbnail={thumbnail}
        title={title}
        className="aspect-square size-10 shrink-0 rounded-sm object-cover"
      />
      <span className="grid min-w-0 flex-1">
        <span className="truncate">{title}</span>
        {detail && (
          <span className="truncate text-meta text-muted-foreground tv:text-sm">{detail}</span>
        )}
      </span>
    </CommandItem>
  );
}

type Placed = {
  collection?: { title: string; parent?: { title: string } } | null;
  creator?: { title: string } | null;
};
// What a held title belongs to: its series, collection and creator.
const placeOf = (item: Placed) => [
  item.collection?.parent?.title,
  item.collection?.title,
  item.creator?.title,
];

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
  const catalogue =
    useQuery({ ...radioSearchQuery(api, "avoid radio", ""), ...held }).data?.stations ?? [];
  return {
    saved: [
      ...later.map((item) => ({
        title: item.title,
        context: placeOf(item).filter(Boolean).join(" "),
        detail: metaLine(...placeOf(item)) || sourceOf(item.url),
        url: item.url,
        source: sourceOf(item.url),
        thumbnail: item.thumbnail,
        href: itemLocation("saved", item.id),
        key: `saved:${item.id}`,
      })),
      ...kept.map((item) => ({
        title: item.title,
        context: "",
        detail: providerNames[item.provider],
        url: item.url,
        source: providerNames[item.provider],
        thumbnail: item.thumbnail,
        href: collectionLocation(item),
        key: `kept:${item.id}`,
      })),
    ],
    played: played.map((item) => ({
      title: item.title,
      context: placeOf(item).filter(Boolean).join(" "),
      detail: metaLine(...placeOf(item)) || item.sourceLabel || sourceOf(item.url),
      url: item.url,
      source: item.sourceLabel ?? sourceOf(item.url),
      thumbnail: item.thumbnail,
      href: itemLocation("history", item.mediaId),
      key: `played:${item.mediaId}`,
    })),
    stations: [...(recentRadio ?? []), ...stations, ...catalogue] as RadioStation[],
  };
}

/**
 * The empty palette under the chips: recent searches and what was played, one column under the field; on the TV, two
 * columns the arrows cross.
 */
function Empty({
  recents,
  onRecent,
  onOpen,
}: {
  recents: string[];
  onRecent: (query: string) => void;
  onOpen: (href: string) => void;
}) {
  const { played } = useHeld();
  const recent = recents.slice(0, 6),
    continuing = played.slice(0, 6);
  return (
    <div className="grid gap-2 tv:grid-cols-2 tv:gap-x-8">
      {recent.length > 0 && (
        <div data-palette-column>
          <CommandGroup heading="Recent searches" data-search-recents>
            {recent.map((query) => (
              <CommandItem key={query} value={`recent:${query}`} onSelect={() => onRecent(query)}>
                <span className="truncate">{query}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </div>
      )}
      {continuing.length > 0 && (
        <div data-palette-column>
          <CommandGroup heading="Continue">
            {continuing.map((item) => (
              <TitleRow
                key={item.key}
                value={`continue:${item.key}`}
                title={item.title}
                detail={item.detail}
                thumbnail={item.thumbnail}
                onSelect={() => onOpen(item.href)}
              />
            ))}
          </CommandGroup>
        </div>
      )}
    </div>
  );
}

/**
 * While typing: the closest match from the fast sources as the top row (a hero on the TV), then what the client holds
 * that matches (the scopes the text names, recent searches, saved and played titles, stations), then the fast sources'
 * hits a section each as they answer, and See all results last. Nothing moves once shown: the top row keeps its place,
 * and a source that answers later comes in below the others.
 */
function Typed({
  text,
  link,
  scope,
  labels,
  recents,
  connected,
  selected,
  moved,
  rowKeys,
  onTop,
  onSelectRow,
  onRun,
  onSearch,
  onRecent,
  onOpen,
  onPlayStation,
  onLink,
}: {
  text: string;
  link: boolean;
  scope: SearchScope;
  labels: string[];
  recents: string[];
  connected: boolean;
  selected: string;
  /** Whether the keys or the pointer moved the selection since the last edit. */
  moved: boolean;
  rowKeys: RefObject<RowKeys | null>;
  onTop: (value: string) => void;
  onSelectRow: (value: string) => void;
  onRun: (run: () => void) => void;
  onSearch: () => void;
  onRecent: (query: string) => void;
  onOpen: (href: string) => void;
  onPlayStation: (station: RadioStation) => void;
  onLink: (verb: LinkVerb, list: { title?: string; count?: number }) => void;
}) {
  const remote = usePaletteHits(link ? "" : text, scope, moved);
  const tv = isTvPresentation();
  const { top } = remote;
  const topValue = top && (tv ? "top:main" : `hit:${top.id}`);
  // The first match is selected as it arrives, and again once an edit that keeps it settles, so Enter is always safe;
  // once the keys or the pointer move, it stays.
  useLayoutEffect(() => {
    if (topValue && remote.typed === text) onTop(topValue);
  }, [topValue, remote.typed, text]);
  // The row whose menu is open, for this query.
  const [menu, setMenu] = useState<{ query: string; id: string } | null>(null);
  const opened = menu?.query === remote.query ? menu.id : null;
  const rowOf = (value: string): SearchHit | undefined =>
    value.startsWith("top:")
      ? top
      : remote.hits.find((hit) => value === `hit:${hit.id}` || value.startsWith(`menu:${hit.id}:`));
  const queueOf = (hit?: SearchHit) =>
    hit?.actions.find(
      (action) => action.label.startsWith("Queue") && action.run && !action.disabled,
    );
  const keys: RowKeys = {
    // Shift+Enter on a result only ever queues; where there is nothing to queue it does nothing.
    queue: (value) => {
      const hit = rowOf(value);
      const queue = queueOf(hit);
      if (queue) onRun(queue.run!);
      return !!hit;
    },
    menu: (value, open) => {
      const hit = rowOf(value);
      if (!hit || !rowMenu(hit).length || open === (opened === hit.id)) return false;
      setMenu(open ? { query: remote.query, id: hit.id } : null);
      if (!open) onSelectRow(hit === top && tv ? "top:more" : `hit:${hit.id}`);
      return true;
    },
    hint: (value) => {
      if (value === "query") return { enter: "See all", menu: false };
      const hit = rowOf(value);
      if (!hit || value.startsWith("menu:")) return;
      return {
        enter: hit.primary.label,
        queue: queueOf(hit)?.label,
        menu: rowMenu(hit).length > 0,
      };
    },
  };
  // The field's keys reach the rows that show: a render React sets aside never publishes its own.
  useLayoutEffect(() => {
    rowKeys.current = keys;
    return () => {
      rowKeys.current = null;
    };
  });
  const toggle = (hit: SearchHit) => () =>
    setMenu(opened === hit.id ? null : { query: remote.query, id: hit.id });
  const held = useHeld();
  // Suggestions follow the typing once it pauses; the query row follows every key.
  const [settled] = useDebouncedValue(text, { wait: 120 });
  // The top row shows once: what Couch holds of the same page doesn't repeat it below.
  const notTop = (item: { url?: string }) =>
    !top || !item.url || (item.url !== top.url && !top.copies?.includes(item.url));
  const found = suggest(settled, scope, {
    recents,
    saved: held.saved.filter(notTop),
    played: held.played.filter(notTop),
    stations: held.stations,
  });
  if (link)
    return (
      <PaletteLink
        url={text}
        connected={connected}
        onOpen={onOpen}
        onLink={onLink}
        onPlayStation={onPlayStation}
        onSearch={onSearch}
      />
    );
  return (
    <>
      {top &&
        (tv ? (
          <TopHero hit={top} menu={opened === top.id} onMenu={toggle(top)} onRun={onRun} />
        ) : (
          <CommandGroup>
            <HitRow hit={top} large menu={opened === top.id} onMenu={toggle(top)} onRun={onRun} />
          </CommandGroup>
        ))}
      {/* The top row's place is kept while the sources answer, so nothing under it moves when it comes. */}
      {!top && remote.asking.length > 0 && (
        <div aria-hidden="true" className="flex items-center gap-3 px-2.5 py-2 tv:px-2 tv:pb-4">
          <Skeleton className="size-14 tv:size-48" />
          <div className="grid gap-2">
            <Skeleton className="h-4 w-48 tv:h-8 tv:w-96" />
            <Skeleton className="h-3 w-32 tv:h-5 tv:w-64" />
          </div>
        </div>
      )}
      {found.recents.length > 0 && (
        <CommandGroup heading="Recent searches" data-search-recents>
          {found.recents.map((query) => (
            <CommandItem key={query} value={`recent:${query}`} onSelect={() => onRecent(query)}>
              <span className="truncate">{query}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {found.saved.length > 0 && (
        <CommandGroup heading="Saved">
          {found.saved.map((item) => (
            <TitleRow
              key={item.key}
              value={item.key}
              title={item.title}
              detail={item.detail}
              thumbnail={item.thumbnail}
              onSelect={() => onOpen(item.href)}
            />
          ))}
        </CommandGroup>
      )}
      {found.played.length > 0 && (
        <CommandGroup heading="Played">
          {found.played.map((item) => (
            <TitleRow
              key={item.key}
              value={item.key}
              title={item.title}
              detail={item.detail}
              thumbnail={item.thumbnail}
              onSelect={() => onOpen(item.href)}
            />
          ))}
        </CommandGroup>
      )}
      {found.stations.length > 0 && (
        <CommandGroup heading="Stations">
          {found.stations.map((station) => (
            <TitleRow
              key={station.id}
              value={`station:${station.id}`}
              title={station.name}
              detail={station.groupTitle ?? kindLabels.radio}
              thumbnail={station.logoUrl}
              onSelect={() => onPlayStation(station)}
            />
          ))}
        </CommandGroup>
      )}
      {remote.sections.map((section) => (
        <CommandGroup key={section.source} heading={section.source}>
          {section.hits.map((hit) => (
            <HitRow
              key={hit.id}
              hit={hit}
              menu={opened === hit.id}
              onMenu={toggle(hit)}
              onRun={onRun}
            />
          ))}
        </CommandGroup>
      ))}
      <CommandGroup>
        <CommandItem value="query" onSelect={onSearch}>
          <Search aria-hidden="true" className="text-muted-foreground" />
          <span className="min-w-0 truncate">See all results for “{text.trim()}”</span>
          {labels.length > 0 && (
            <span className="max-w-1/2 shrink-0 truncate text-muted-foreground">
              in {labels.join(", ")}
            </span>
          )}
        </CommandItem>
      </CommandGroup>
      <PaletteFoot asking={remote.asking} failed={remote.failed} keys={keys.hint(selected)} />
      {remote.sources}
    </>
  );
}
