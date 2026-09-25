import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import type { SessionState } from "../../../shared/protocol";
import type { Credentials } from "../../session/session";
import { ForLaterSection } from "./ForLaterSection";
import { SavedFavorites, type SavedFavoriteActions } from "./SavedFavorites";
import { SavedPlaylists } from "@/components/SavedPlaylists";
import { Button } from "@/components/ui/button";
import { useOptionalShell } from "@/sections/shell/shell-context";
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
  const redesigned = useOptionalShell()?.standardLayout;
  const [tab, setTab] = useState<SavedTab>("later");
  const showCounts = !!redesigned && active && connected;
  const laterCount = useQuery({ ...forLaterQuery(credentials), enabled: showCounts });
  const providerCount = useQuery({ ...providerFavoritesQuery(credentials), enabled: showCounts });
  const radioCount = useQuery({ ...radioFavoritesListQuery(credentials), enabled: showCounts });
  const listsCount = useQuery({ queryKey: ["saved", "list-count", credentials.origin, credentials.token, state?.playlistVersion], enabled: showCounts, queryFn: () => apiFetch(credentials, "/api/playlists").then(response => response.json() as Promise<{ playlists: unknown[] }>) });
  const tabs = [
    ["later", "For later", laterCount.data?.items.length],
    ["channels", "Channels and stations", (providerCount.data?.favorites.length ?? 0) + (radioCount.data?.favorites.length ?? 0)],
    ["lists", "Lists", listsCount.data?.playlists.length],
  ] as const;
  const later = <ForLaterSection origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} inspect onFind={() => onBrowse("Search")} showHeading={!redesigned} />;
  const channels = <SavedFavorites origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} showHeading={!redesigned} {...favoriteActions} />;
  const lists = <SavedPlaylists origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} version={state?.playlistVersion ?? 0} queueCount={state?.queue.length ?? 0} inline />;

  return <section className="min-w-0 pb-8" aria-label="Saved media">
    {active && (redesigned ? <div className="saved-page-layout -ml-[.8rem] grid grid-cols-[15rem_minmax(0,1fr)] gap-8 max-[700px]:ml-0 max-[700px]:grid-cols-1">
      <nav className="saved-page-nav" aria-label="Saved sections">
        {tabs.map(([value, label, count]) => <Button key={value} variant="ghost" className="h-12 w-full justify-start gap-3 rounded-none px-3 text-left font-normal" aria-pressed={tab === value} onClick={() => setTab(value)}>
          <Check aria-hidden="true" className={`size-4 shrink-0 ${tab === value ? "" : "invisible"}`} />
          <span className="min-w-0 flex-1">{label}</span>
          {connected && <span className="tabular-nums text-muted-foreground">{count ?? "…"}</span>}
        </Button>)}
      </nav>
      <div className="saved-page-content min-w-0">
        <p className="mb-5 text-sm text-muted-foreground">Shared with everyone who uses {state?.installationName || "this Couch"}.</p>
        {tab === "later" ? later : tab === "channels" ? channels : <div className="saved-lists-tab">{lists}</div>}
      </div>
    </div> : <div className="space-y-10">{later}{lists}{channels}</div>)}
  </section>;
}
