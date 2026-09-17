import type { SessionState } from "../../../shared/protocol";
import type { Credentials } from "../../session/session";
import { ForLaterSection } from "./ForLaterSection";
import { SavedFavorites, type SavedFavoriteActions } from "./SavedFavorites";
import { SavedPlaylists } from "@/components/SavedPlaylists";

export function SavedSection({ state, credentials, connected, canPlay, active, onBrowse, ...favoriteActions }: SavedFavoriteActions & {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  active: boolean;
  onBrowse: (section: string) => void;
}) {
  // SavedPlaylists stays at the client root: the Now section's Up next imports
  // it too, so moving it belongs to the cleanup layer (flagged on #362).
  return <section className="min-w-0 pb-8" aria-label="Saved media">
    {active && <div className="space-y-10">
      <ForLaterSection origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} inspect onFind={() => onBrowse("Search")} />
      <SavedPlaylists origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} version={state?.playlistVersion ?? 0} queueCount={state?.queue.length ?? 0} inline />
      <SavedFavorites origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} {...favoriteActions} />
    </div>}
  </section>;
}
