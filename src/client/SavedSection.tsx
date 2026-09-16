import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SessionState } from "../shared/protocol";
import type { Credentials } from "./session/session";
import { ForLaterSection } from "./ForLaterSection";
import { SavedPlaylists } from "./SavedPlaylists";
import { SavedFavorites, type SavedFavoriteActions } from "./SavedFavorites";
import "./saved-section.css";

export function SavedSection({ state, credentials, connected, canPlay, active, onBrowse, ...favoriteActions }: SavedFavoriteActions & {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  active: boolean;
  onBrowse: (section: string) => void;
}) {
  const [tab, setTab] = useState("Items");
  useEffect(() => { setTab("Items"); }, [credentials.origin, credentials.token]);
  const shared = { ...credentials, connected, canPlay };
  return <section className="saved-section" aria-label="Saved media">
    <h1>Saved</h1>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="saved-tabs" aria-label="Saved collections">
        {["Items", "Playlists"].map(name => <TabsTrigger key={name} value={name}>{name}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="Items">{active && <div className="saved-items space-y-8"><ForLaterSection inspect {...shared} version={state?.forLaterVersion ?? 0} onFind={() => onBrowse("Search")} /><SavedFavorites {...shared} {...favoriteActions} providerVersion={state?.providerVersion ?? 0} radioVersion={state?.radioVersion ?? 0} /></div>}</TabsContent>
      <TabsContent value="Playlists">{active && <SavedPlaylists {...shared} version={state?.playlistVersion ?? 0} queueCount={state?.queue.length ?? 0} inline />}</TabsContent>
    </Tabs>
  </section>;
}
