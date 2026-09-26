import type { ClientSessionState } from "@/session/session";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";

import type { Credentials } from "../../session/session";
import { ForLaterSection } from "./ForLaterSection";
import { SavedFavorites, type SavedFavoriteActions } from "./SavedFavorites";
import { SavedPlaylists } from "@/components/SavedPlaylists";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { forLaterQuery } from "@/api/for-later";
import { providerFavoritesQuery } from "@/api/providers";
import { radioFavoritesListQuery } from "@/api/radio";
import { playlistsQuery } from "@/api/playlists";
import { deviceName } from "@/copy";

export const savedTabs = ["later", "channels", "lists"] as const;
export type SavedTab = typeof savedTabs[number];

// Tailwind's `md`, where Settings shows its rail: a rail beside the content,
// or a tab strip above it on phones.
const wideQuery = "(min-width: 48rem)";
const subscribeWide = (onChange: () => void) => {
  const media = window.matchMedia?.(wideQuery);
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
};
const isWide = () => window.matchMedia?.(wideQuery).matches ?? true;

export function SavedSection({ state, credentials, connected, canPlay, tab, onTabChange, onFind, ...favoriteActions }: SavedFavoriteActions & {
  state: ClientSessionState | null;
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  tab: SavedTab;
  onTabChange: (tab: SavedTab) => void;
  onFind: () => void;
}) {
  const page = useRef<HTMLElement>(null);
  const wide = useSyncExternalStore(subscribeWide, isWide, () => true);
  // The TV starts on the current tab so the remote can move straight into it.
  useEffect(() => {
    if (!page.current?.closest(".tv-shell")) return;
    const frame = requestAnimationFrame(() => page.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const later = useQuery({ ...forLaterQuery(credentials), enabled: connected });
  const online = useQuery({ ...providerFavoritesQuery(credentials), enabled: connected });
  const radio = useQuery({ ...radioFavoritesListQuery(credentials), enabled: connected });
  const lists = useQuery({ ...playlistsQuery(credentials), enabled: connected });
  const tabs = [
    ["later", "For later", later.data?.items.length],
    ["channels", "Channels & stations", online.data && radio.data && online.data.favorites.length + radio.data.favorites.length],
    ["lists", "Lists", lists.data?.playlists.length],
  ] as const;

  return <section ref={page} className="min-w-0 pb-8" aria-label="Saved">
    <Tabs value={tab} onValueChange={value => onTabChange(value as SavedTab)} orientation={wide ? "vertical" : "horizontal"} className="grid gap-6 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-12">
      <div className="min-w-0">
        <p className="mb-1 truncate text-xs text-muted-foreground md:px-2.5">Shared on {deviceName(state?.installationName)}</p>
        <TabsList variant="line" aria-label="Saved sections" className="h-auto w-full items-stretch justify-start gap-0 p-0 group-data-horizontal/tabs:h-auto group-data-horizontal/tabs:overflow-x-auto group-data-horizontal/tabs:border-b">
          {tabs.map(([value, label, count], index) => <TabsTrigger key={value} value={value} data-page-first={index === 0 || undefined}
            className="h-8 flex-none justify-start gap-1.5 px-2.5 py-0 font-normal touch:h-11 group-data-horizontal/tabs:rounded-none group-data-horizontal/tabs:after:bottom-0 group-data-vertical/tabs:text-foreground group-data-vertical/tabs:after:hidden group-data-vertical/tabs:hover:bg-muted dark:group-data-vertical/tabs:text-foreground">
            <Check aria-hidden="true" className={`hidden size-[1.15em] group-data-vertical/tabs:block ${tab === value ? "" : "invisible"}`} />
            <span className="min-w-0 flex-1 text-left">{label}</span>
            {count != null && <span className="tabular-nums text-muted-foreground">{count}</span>}
          </TabsTrigger>)}
        </TabsList>
      </div>
      <div className="min-w-0">
        <TabsContent value="later">
          <PageHeader title="For later" />
          <ForLaterSection origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} onFind={onFind} showHeading={false} />
        </TabsContent>
        <TabsContent value="channels">
          <PageHeader title="Channels & stations" />
          <SavedFavorites origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} onFind={onFind} {...favoriteActions} />
        </TabsContent>
        <TabsContent value="lists">
          <SavedPlaylists origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} queueCount={state?.queue.length ?? 0} />
        </TabsContent>
      </div>
    </Tabs>
  </section>;
}
