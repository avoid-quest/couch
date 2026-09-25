import { useState } from "react";
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
import { apiFetch } from "@/api/client";

type SavedTab = "later" | "channels" | "lists";

export function SavedSection({ state, credentials, connected, canPlay, active, onBrowse, ...favoriteActions }: SavedFavoriteActions & {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  active: boolean;
  onBrowse: (section: string) => void;
}) {
  const [tab, setTab] = useState<SavedTab>("later");
  const showCounts = active && connected;
  const laterCount = useQuery({ ...forLaterQuery(credentials), enabled: showCounts });
  const providerCount = useQuery({ ...providerFavoritesQuery(credentials), enabled: showCounts });
  const radioCount = useQuery({ ...radioFavoritesListQuery(credentials), enabled: showCounts });
  const listsCount = useQuery({ queryKey: ["saved", "list-count", credentials.origin, credentials.token, state?.playlistVersion], enabled: showCounts, queryFn: () => apiFetch(credentials, "/api/playlists").then(response => response.json() as Promise<{ playlists: unknown[] }>) });
  const tabs = [
    ["later", "For later", laterCount.data?.items.length],
    ["channels", "Channels and stations", (providerCount.data?.favorites.length ?? 0) + (radioCount.data?.favorites.length ?? 0)],
    ["lists", "Lists", listsCount.data?.playlists?.length],
  ] as const;
  const later = <ForLaterSection origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} inspect onFind={() => onBrowse("Search")} showHeading={false} />;
  const channels = <SavedFavorites origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} showHeading={false} {...favoriteActions} />;
  const lists = <SavedPlaylists origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} version={state?.playlistVersion ?? 0} queueCount={state?.queue.length ?? 0} inline />;

  return <section className="min-w-0 pb-8" aria-label="Saved media">
    {active && <Tabs value={tab} onValueChange={value => setTab(value as SavedTab)} orientation="vertical" className="saved-page-layout -ml-[.8rem] grid grid-cols-[15rem_minmax(0,1fr)] gap-8 max-[700px]:ml-0 max-[700px]:grid-cols-1">
      <TabsList variant="line" className="saved-page-nav w-full" aria-label="Saved sections">
        {tabs.map(([value, label, count]) => <TabsTrigger key={value} value={value} className="h-12 w-full justify-start gap-3 rounded-none px-3 text-left font-normal">
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
