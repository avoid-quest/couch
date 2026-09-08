import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SessionState } from "../shared/protocol";
import type { Credentials } from "./session";
import { ForLaterSection } from "./ForLaterSection";
import { HistoryPanel, type HistoryPlayback } from "./HistoryPanel";
import { SavedPlaylists } from "./SavedPlaylists";
import "./saved-section.css";

export function SavedSection({ state, credentials, connected, canPlay, onPlay, active }: {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  onPlay: HistoryPlayback;
  active: boolean;
}) {
  const [tab, setTab] = useState("For later");
  const shared = { ...credentials, connected, canPlay };
  return <section className="saved-section" aria-label="Saved media">
    <h1>Saved</h1>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="saved-tabs" aria-label="Saved collections">
        {["For later", "Playlists", "History"].map(name => <TabsTrigger key={name} value={name}>{name}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="For later">{active && <ForLaterSection inspect {...shared} version={state?.forLaterVersion ?? 0} />}</TabsContent>
      <TabsContent value="Playlists">{active && <SavedPlaylists {...shared} version={state?.playlistVersion ?? 0} queueCount={state?.queue.length ?? 0} inline />}</TabsContent>
      <TabsContent value="History"><HistoryPanel presentation="inspect" key={state?.activeProfile.id} {...shared} version={state?.libraryVersion ?? 0} onPlay={onPlay} active={active && tab === "History"} /></TabsContent>
    </Tabs>
  </section>;
}
