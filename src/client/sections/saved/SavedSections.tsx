import type { ClientSessionState } from "@/session/session";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";

import type { Credentials } from "../../session/session";
import { ForLaterSection } from "./ForLaterSection";
import { PlayedSection } from "./PlayedSection";
import { SavedFavorites, type SavedFavoriteActions } from "./SavedFavorites";
import { SavedPlaylists } from "@/components/SavedPlaylists";
import { PageHeader } from "@/components/PageHeader";
import { MediaRowsSkeleton } from "@/components/LoadingMedia";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { forLaterQuery } from "@/api/for-later";
import { providerFavoritesQuery } from "@/api/providers";
import { radioFavoritesListQuery } from "@/api/radio";
import { playlistsQuery } from "@/api/playlists";
import { historyQuery } from "@/api/progress";

export const savedTabs = ["later", "channels", "lists", "played"] as const;
export type SavedTab = typeof savedTabs[number];

/** Saved's sections the way Settings shows its pages: a rail on wide screens, a Select on narrow ones. */
export function SavedSections({ state, credentials, connected, canPlay, tab: named, onTabChange, onFind, ...favoriteActions }: SavedFavoriteActions & {
  state: ClientSessionState | null;
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  /** The tab the URL names; without one, the first that holds something. */
  tab?: SavedTab;
  onTabChange: (tab: SavedTab) => void;
  onFind: () => void;
}) {
  const page = useRef<HTMLElement>(null);
  const later = useQuery({ ...forLaterQuery(credentials), enabled: connected });
  const online = useQuery({ ...providerFavoritesQuery(credentials), enabled: connected });
  const radio = useQuery({ ...radioFavoritesListQuery(credentials), enabled: connected });
  const lists = useQuery({ ...playlistsQuery(credentials), enabled: connected });
  const played = useQuery({ ...historyQuery(credentials), enabled: connected });
  const tabs = [
    ["later", "For later", later.data?.items.length, later.isPending],
    ["channels", "Channels & stations", online.data && radio.data && online.data.favorites.length + radio.data.favorites.length, online.isPending || radio.isPending],
    ["lists", "Lists", lists.data?.playlists.length, lists.isPending],
    ["played", "Played", played.data?.items.length, played.isPending],
  ] as const;
  // Saved opens on the first tab that holds something, as soon as the tabs before it are known to be empty.
  const first = tabs.find(([, , count, pending]) => connected && pending || !!count);
  const tab = named ?? first?.[0] ?? "later";
  // Choosing waits for the counts behind a plain skeleton, so a tab that turns out empty is never opened only to say so.
  const choosing = !named && !!first?.[3] && connected;
  // Once it has chosen, the URL names the tab, so the rail and Back agree with the page.
  // Asked once per choice: the router renders again before the URL changes, and asking again would cancel the first.
  const asked = useRef<SavedTab | undefined>(undefined);
  useEffect(() => {
    if (named) asked.current = undefined;
    else if (connected && !choosing && asked.current !== tab) { asked.current = tab; onTabChange(tab); }
  }, [named, connected, choosing, tab, onTabChange]);
  const detailFocus = useLocation({ select: location => location.state.detailFocus });
  // Section entry yields to detail restoration and any later user focus.
  useEffect(() => {
    if (!page.current?.closest(".tv-shell")) return;
    const focused = document.activeElement;
    const frame = requestAnimationFrame(() => {
      if ((!detailFocus && document.activeElement === focused) || document.activeElement === document.body)
        page.current?.querySelector<HTMLElement>('nav [aria-current="page"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, detailFocus]);
  return <section ref={page} aria-label="Saved" className="grid min-w-0 items-start gap-6 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-12">
    <Select value={tab} onValueChange={value => onTabChange(value as SavedTab)}>
      <SelectTrigger aria-label="Saved section" data-page-first className="w-full md:hidden"><SelectValue>{tabs.find(([value]) => value === tab)?.[1]}</SelectValue></SelectTrigger>
      <SelectContent>{tabs.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
    </Select>
    <nav data-nav-rail aria-label="Saved sections" className="hidden min-w-0 flex-col md:flex">
      {tabs.map(([value, label, count]) => <Button key={value} variant="ghost" asChild className="h-10 w-full justify-start rounded-none border-y-0 border-r-0 border-l-2 border-transparent pl-3 font-normal text-muted-foreground aria-[current=page]:border-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground">
        <Link to="/saved" search={{ tab: value }} replace activeOptions={{ exact: true }} aria-current={tab === value ? "page" : undefined} data-page-first={tab === value || undefined}>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {!!count && <span className="tabular-nums text-muted-foreground">{count}</span>}
        </Link>
      </Button>)}
    </nav>
    <div data-nav-content className="min-w-0">{choosing ? <MediaRowsSkeleton /> : <>
      {tab === "later" && <><PageHeader title="For later" hidden /><ForLaterSection origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} onFind={onFind} showHeading={false} /></>}
      {tab === "channels" && <><PageHeader title="Channels & stations" hidden /><SavedFavorites origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} onFind={onFind} {...favoriteActions} /></>}
      {tab === "lists" && <SavedPlaylists origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} queueCount={state?.queue.length ?? 0} onFind={onFind} />}
      {tab === "played" && <><PageHeader title="Played" hidden /><PlayedSection origin={credentials.origin} token={credentials.token} connected={connected} onFind={onFind} /></>}
    </>}</div>
  </section>;
}
