import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SessionState } from "../../../shared/protocol";
import type { Credentials } from "../../session/session";
import { ForLaterSection } from "./ForLaterSection";
import { SavedFavorites, type SavedFavoriteActions } from "./SavedFavorites";
import { SavedPlaylists } from "@/components/SavedPlaylists";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { forLaterQuery } from "@/api/for-later";
import { providerFavoritesQuery } from "@/api/providers";
import { radioFavoritesListQuery } from "@/api/radio";
import { playlistsQuery } from "@/api/playlists";

type SavedTab = "later" | "channels" | "lists";
let lastSavedTab: SavedTab = "later";
let lastSavedContext = "";

export function SavedSection({ state, credentials, connected, canPlay, active, onBrowse, ...favoriteActions }: SavedFavoriteActions & {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  active: boolean;
  onBrowse: (section: string) => void;
}) {
  const context = `${credentials.origin}\0${credentials.token}`;
  const page = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<SavedTab>(() => {
    if (lastSavedContext !== context) { lastSavedContext = context; lastSavedTab = "later"; }
    return lastSavedTab;
  });
  useEffect(() => {
    if (lastSavedContext !== context) { lastSavedContext = context; lastSavedTab = "later"; setTab("later"); }
  }, [context]);
  useEffect(() => {
    if (!active || !page.current?.closest(".tv-shell")) return;
    const frame = requestAnimationFrame(() => page.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [active]);
  const showCounts = active && connected;
  const laterCount = useQuery({ ...forLaterQuery(credentials), enabled: showCounts });
  const providerCount = useQuery({ ...providerFavoritesQuery(credentials), enabled: showCounts });
  const radioCount = useQuery({ ...radioFavoritesListQuery(credentials), enabled: showCounts });
  const listsCount = useQuery({ ...playlistsQuery(credentials), enabled: showCounts });
  const tabs = [
    ["later", "For later", laterCount.data?.items.length],
    ["channels", "Channels and stations", (providerCount.data?.favorites.length ?? 0) + (radioCount.data?.favorites.length ?? 0)],
    ["lists", "Lists", listsCount.data?.playlists?.length],
  ] as const;
  const later = <ForLaterSection origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} inspect onFind={() => onBrowse("Search")} showHeading={false} />;
  const channels = <SavedFavorites origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} showHeading={false} {...favoriteActions} />;
  const lists = <SavedPlaylists origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} queueCount={state?.queue.length ?? 0} inline />;

  return <section ref={page} className="min-w-0 pb-8" aria-label="Saved media">
    {active && <Tabs value={tab} onValueChange={value => { lastSavedTab = value as SavedTab; setTab(lastSavedTab); }} orientation="vertical" className="saved-page-layout -ml-[.8rem] grid grid-cols-[15rem_minmax(0,1fr)] gap-8 max-[700px]:ml-0 max-[700px]:grid-cols-1">
      <TabsList variant="line" className="saved-page-nav w-full" aria-label="Saved sections">
        {tabs.map(([value, label, count], index) => <TabsTrigger key={value} value={value} data-page-first={index === 0 || undefined} className="h-12 w-full justify-start gap-3 rounded-none px-3 text-left font-normal">
          <span className="min-w-0 flex-1">{label}</span>
          {connected && <span className="tabular-nums text-muted-foreground">{count ?? "…"}</span>}
        </TabsTrigger>)}
      </TabsList>
      <div className="saved-page-content min-w-0">
        <p className="mb-5 text-sm text-muted-foreground">Shared with everyone who uses {state?.installationName || "this Couch"}.</p>
        <TabsContent value="later">{later}</TabsContent>
        <TabsContent value="channels">{channels}</TabsContent>
        <TabsContent value="lists"><div className="saved-lists-tab">{lists}</div></TabsContent>
      </div>
    </Tabs>}
  </section>;
}
