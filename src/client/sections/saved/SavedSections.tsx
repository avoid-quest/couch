import type { ClientSessionState } from "@/session/session";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { Check } from "lucide-react";

import type { Credentials } from "../../session/session";
import { ForLaterSection } from "./ForLaterSection";
import { PlayedSection } from "./PlayedSection";
import { SavedFavorites, type SavedFavoriteActions } from "./SavedFavorites";
import { SavedPlaylists } from "@/components/SavedPlaylists";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { forLaterQuery } from "@/api/for-later";
import { providerFavoritesQuery } from "@/api/providers";
import { radioFavoritesListQuery } from "@/api/radio";
import { playlistsQuery } from "@/api/playlists";
import { historyQuery } from "@/api/progress";
import { deviceName } from "@/copy";

export const savedTabs = ["later", "channels", "lists", "played"] as const;
export type SavedTab = typeof savedTabs[number];

/** Saved's sections the way Settings shows its pages: a rail with a check on wide screens, a Select on narrow ones. */
export function SavedSections({ state, credentials, connected, canPlay, tab, onTabChange, onFind, ...favoriteActions }: SavedFavoriteActions & {
  state: ClientSessionState | null;
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  tab: SavedTab;
  onTabChange: (tab: SavedTab) => void;
  onFind: () => void;
}) {
  const page = useRef<HTMLElement>(null);
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
  const later = useQuery({ ...forLaterQuery(credentials), enabled: connected });
  const online = useQuery({ ...providerFavoritesQuery(credentials), enabled: connected });
  const radio = useQuery({ ...radioFavoritesListQuery(credentials), enabled: connected });
  const lists = useQuery({ ...playlistsQuery(credentials), enabled: connected });
  const played = useQuery({ ...historyQuery(credentials), enabled: connected });
  const tabs = [
    ["later", "For later", later.data?.items.length],
    ["channels", "Channels & stations", online.data && radio.data && online.data.favorites.length + radio.data.favorites.length],
    ["lists", "Lists", lists.data?.playlists.length],
    ["played", "Played", played.data?.items.length],
  ] as const;
  const shared = `Shared on ${deviceName(state?.installationName)}`;

  return <section ref={page} aria-label="Saved" className="grid min-w-0 items-start gap-6 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-12">
    <Select value={tab} onValueChange={value => onTabChange(value as SavedTab)}>
      <SelectTrigger aria-label="Saved section" data-page-first className="w-full md:hidden"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>
        <SelectLabel>{shared}</SelectLabel>
        {tabs.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
      </SelectGroup></SelectContent>
    </Select>
    <nav aria-label="Saved sections" className="hidden min-w-0 flex-col md:flex">
      <p aria-hidden="true" className="mb-1 truncate px-2.5 text-xs text-muted-foreground">{shared}</p>
      {tabs.map(([value, label, count]) => <Button key={value} variant="ghost" asChild className="w-full justify-start font-normal">
        <Link to="/saved" search={value === "later" ? {} : { tab: value }} replace activeOptions={{ exact: true }} data-page-first={tab === value || undefined}>
          <Check aria-hidden="true" className={tab === value ? undefined : "invisible"} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {count != null && <span className="tabular-nums text-muted-foreground">{count}</span>}
        </Link>
      </Button>)}
    </nav>
    {/* Narrow screens name the tab in the Select above, so its title is for screen readers there. */}
    <div className="min-w-0">
      {tab === "later" && <><PageHeader title="For later" className="max-md:sr-only" /><ForLaterSection origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} onFind={onFind} showHeading={false} /></>}
      {tab === "channels" && <><PageHeader title="Channels & stations" className="max-md:sr-only" /><SavedFavorites origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} onFind={onFind} {...favoriteActions} /></>}
      {tab === "lists" && <SavedPlaylists origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} queueCount={state?.queue.length ?? 0} />}
      {tab === "played" && <><PageHeader title="Played" className="max-md:sr-only" /><PlayedSection origin={credentials.origin} token={credentials.token} connected={connected} onFind={onFind} /></>}
    </div>
  </section>;
}
