import { useEffect, useState } from "react";
import { Check, PencilLine } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { SessionState } from "../../../shared/protocol";
import type { Credentials } from "../../session/session";
import { ForLaterSection } from "./ForLaterSection";
import { SavedFavorites, type SavedFavoriteActions } from "./SavedFavorites";
import { SavedPlaylists } from "@/components/SavedPlaylists";

export function SavedSection({ state, credentials, connected, canPlay, active, editing = false, onToggleEdit, onBrowse, ...favoriteActions }: SavedFavoriteActions & {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  active: boolean;
  editing?: boolean;
  onToggleEdit?: () => void;
  onBrowse: (section: string) => void;
}) {
  const [tab, setTab] = useState("Items");
  useEffect(() => { setTab("Items"); }, [credentials.origin, credentials.token]);
  // SavedPlaylists stays at the client root: the Now section's queue imports
  // it too, so moving it belongs to the cleanup layer (flagged on #362).
  return <section className="min-w-0 px-5 pb-8 pt-7 md:px-6" aria-label="Saved media">
    <div className="mb-5 flex items-start justify-between gap-3">
      <h1 className="text-[27px] font-semibold leading-[1.15] tracking-[-0.9px] md:text-[34px] md:tracking-[-1.2px]">Saved</h1>
      {onToggleEdit && <Button variant="ghost" size="icon" aria-label={editing ? "Done customizing" : "Customize this page"} aria-pressed={editing} onClick={onToggleEdit}>{editing ? <Check aria-hidden="true" /> : <PencilLine aria-hidden="true" />}</Button>}
    </div>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="h-auto w-full justify-start gap-2 rounded-none border-b bg-transparent p-0 pb-3.5" aria-label="Saved collections">
        {["Items", "Playlists"].map(name => <TabsTrigger key={name} value={name} className="min-h-11 flex-none px-4 py-2 text-sm data-active:bg-secondary data-active:shadow-none dark:data-active:bg-secondary">{name}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="Items" className="pt-4.5">{active && <div className="space-y-8">
        <ForLaterSection origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} inspect editing={editing} onFind={() => onBrowse("Search")} />
        <SavedFavorites origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} editing={editing} {...favoriteActions} />
      </div>}</TabsContent>
      <TabsContent value="Playlists" className="pt-4.5">{active && <SavedPlaylists origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} version={state?.playlistVersion ?? 0} queueCount={state?.queue.length ?? 0} inline />}</TabsContent>
    </Tabs>
  </section>;
}
