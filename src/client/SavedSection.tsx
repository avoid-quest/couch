import { useEffect, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SessionState } from "../shared/protocol";
import type { Credentials } from "./session";
import { ForLaterSection } from "./ForLaterSection";
import { HistoryPanel, type HistoryPlayback } from "./HistoryPanel";
import { SavedPlaylists } from "./SavedPlaylists";
import { SavedFavorites, type SavedFavoriteActions } from "./SavedFavorites";
import { Button } from "@/components/ui/button";
import "./saved-section.css";
import { personalProfileName } from "./profile-name";

export function SavedSection({ state, credentials, connected, canPlay, onPlay, active, onBrowse, ...favoriteActions }: SavedFavoriteActions & {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  onPlay: HistoryPlayback;
  active: boolean;
  onBrowse: (section: string) => void;
}) {
  const [tab, setTab] = useState("Items");
  const [history, setHistory] = useState(false);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const historyBack = useRef<HTMLButtonElement>(null);
  const previousHistory = useRef(false);
  useEffect(() => { setHistory(false); setTab("Items"); }, [credentials.origin, credentials.token]);
  useEffect(() => {
    if (previousHistory.current === history) return;
    previousHistory.current = history;
    if (!active) return;
    const frame = requestAnimationFrame(() => (history ? historyBack.current : historyTrigger.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [history, active]);
  const shared = { ...credentials, connected, canPlay };
  return <section className="saved-section" aria-label="Saved media">
    <h1>{history ? "Viewing history" : "Saved"}</h1>
    {history ? <>
      <Button ref={historyBack} data-back variant="outline" onClick={() => setHistory(false)}>Back to Saved</Button>
      <HistoryPanel presentation="inspect" key={state?.activeProfile.id} {...shared} version={state?.libraryVersion ?? 0} onPlay={onPlay} active={active} />
    </> : <>
    <div className="saved-intro"><p className="text-sm text-muted-foreground">Videos, music and stations saved by everyone on this TV.</p><Button variant="outline" onClick={() => onBrowse("Search")}>Find something to save</Button></div>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="saved-tabs" aria-label="Saved collections">
        {["Items", "Playlists"].map(name => <TabsTrigger key={name} value={name}>{name}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="Items">{active && <div className="saved-items space-y-8"><ForLaterSection inspect {...shared} version={state?.forLaterVersion ?? 0} onFind={() => onBrowse("Search")} /><SavedFavorites {...shared} {...favoriteActions} providerVersion={state?.providerVersion ?? 0} radioVersion={state?.radioVersion ?? 0} /></div>}</TabsContent>
      <TabsContent value="Playlists">{active && <SavedPlaylists {...shared} version={state?.playlistVersion ?? 0} queueCount={state?.queue.length ?? 0} inline />}</TabsContent>
    </Tabs>
    <Button ref={historyTrigger} variant="ghost" onClick={() => setHistory(true)}>{personalProfileName(state?.activeProfile) ? `Viewing history for ${personalProfileName(state?.activeProfile)}` : "Your viewing history"}</Button>
    </>}
  </section>;
}
