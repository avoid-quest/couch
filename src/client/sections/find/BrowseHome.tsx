import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item } from "@/components/ui/item";
import { AuthArtwork } from "@/components/AuthArtwork";
import { MediaArtwork } from "@/components/MediaArtwork";
import { DurationBar } from "@/components/DurationBar";
import { ForLaterSection } from "../saved/ForLaterSection";
import { historyQuery, removeFromContinue, undoProgressAction } from "@/api/library";
import { forLaterQuery } from "@/api/for-later";
import { librarySourcesQuery } from "@/api/library";
import { jellyfinQuery } from "@/api/jellyfin";
import { iptvSourcesQuery } from "@/api/iptv";
import { useOptionalSessionGate } from "@/session/session-context";
import { progressTime, type HistoryPlayback } from "@/components/HistoryPanel";
import type { HistoryItem } from "../../../shared/library";
import type { SessionState } from "../../../shared/protocol";
import type { Credentials } from "../../session/session";

export function BrowseHome({ state, credentials, connected, canPlay, canManageMetadata = false, active, onAddSource, onPlay, onAdd }: {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  canManageMetadata?: boolean;
  active: boolean;
  onAddSource?: () => void;
  onPlay: HistoryPlayback;
  onAdd: (item: HistoryItem) => Promise<boolean>;
}) {
  const session = useOptionalSessionGate();
  const history = useQuery({ ...historyQuery(credentials), enabled: connected && active });
  const later = useQuery({ ...forLaterQuery(credentials), enabled: connected && active });
  const sources = useQuery({ ...librarySourcesQuery(credentials), enabled: connected && active && canManageMetadata });
  const jellyfin = useQuery({ ...jellyfinQuery(credentials, true), enabled: connected && active && canManageMetadata });
  const iptv = useQuery({ ...iptvSourcesQuery(credentials), enabled: connected && active && canManageMetadata });
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const unfinished = (history.data?.items ?? []).filter(item => item.position > 0 && !item.watched);
  const savedMedia = later.data?.items.filter(item => item.kind !== "radio" && !item.live) ?? [];
  const host = state?.installationName ?? new URL(credentials.origin).hostname;
  const playable = (item: HistoryItem) => connected && canPlay && !pending && !!(item.playable || item.libraryItemId || item.queueEntryId);
  async function act(item: HistoryItem, action: "resume" | "start" | "queue" | "remove") {
    if (pending) return;
    setPending(true); setError(""); setNotice("");
    try {
      if (action === "remove") {
        const result = await removeFromContinue(credentials, item.mediaId);
        await history.refetch();
        if (result.undoToken && result.expiresAt && result.expiresAt > Date.now()) session?.offerUndo(`Removed ${item.title} from Continue`, async () => {
          await undoProgressAction(credentials, result.undoToken!);
          await history.refetch();
        }, result.expiresAt - Date.now());
        return;
      }
      const ok = action === "queue" ? await onAdd(item) : await onPlay(item, { fromStart: action === "start" });
      if (ok) setNotice(action === "queue" ? `Added ${item.title} to Up next.` : `${action === "start" ? "Starting" : "Resuming"} ${item.title} on the playback computer.`);
      else if (action === "queue") setError(`Could not add ${item.title} to Up next.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not use this title."); }
    finally { setPending(false); }
  }
  return <section className="find-home" aria-label="Browse and resume">
    {!connected && <p role="status">Reconnect to see Continue and For later.</p>}
    {history.error && <Alert variant="destructive"><AlertDescription>{history.error instanceof Error ? history.error.message : "Could not load Continue."}<Button variant="outline" onClick={() => void history.refetch()}>Try again</Button></AlertDescription></Alert>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!!unfinished.length && <section className="find-home-section" aria-label="Continue"><h2>Continue</h2><ul>{unfinished.map(item => <Item asChild key={item.mediaId} className="find-home-row"><li data-nav-row>
      {item.artworkId ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={item.artworkId} className="find-home-art" /> : <MediaArtwork thumbnail={item.thumbnail} title={item.title} className="find-home-art" />}
      <Button variant="ghost" className="result-main" aria-label={`Resume ${item.title}`} disabled={!playable(item)} onClick={() => void act(item, "resume")}><strong>{item.title}</strong><small>{item.sourceLabel || (item.libraryItemId ? "TV folders" : "Continue")}</small><DurationBar duration={item.duration} position={item.position} /></Button>
      <div className="find-home-actions [@media(hover:none)]:opacity-100 [@media(hover:none)]:visible"><Button variant="ghost" disabled={!playable(item)} onClick={() => void act(item, "start")}>From start</Button><Button variant="ghost" disabled={!connected || pending} onClick={() => void act(item, "queue")}>Queue</Button><Button variant="ghost" disabled={!connected || pending} onClick={() => void act(item, "remove")}>Remove</Button></div>
    </li></Item>)}</ul></section>}
    {!!savedMedia.length && <section className="find-home-section"><ForLaterSection origin={credentials.origin} token={credentials.token} connected={connected} canPlay={canPlay} inspect mediaOnly /></section>}
    {!history.isPending && !later.isPending && !unfinished.length && !savedMedia.length && <Empty className="find-empty items-start text-left"><EmptyHeader className="items-start"><EmptyTitle><h2>Find something to play</h2></EmptyTitle><EmptyDescription>Search YouTube, Twitch, RaiPlay, radio stations and your TV folders at once, or paste a link from any page with video. What you don't finish shows up here to continue.</EmptyDescription></EmptyHeader><EmptyContent className="max-w-none items-start">
      {canManageMetadata ? <div className="find-empty-sources"><h3>Sources on {host}</h3><div><span>TV folders</span><span>{sources.data?.sources.length ? `${sources.data.sources.length} folder${sources.data.sources.length === 1 ? "" : "s"} · ${sources.data.sources.some(source => source.status === "scanning") ? "Scanning" : sources.data.sources.some(source => source.status === "error" || source.status === "unavailable") ? "Needs attention" : "Ready"}` : "Not set up"}</span></div><div><span>Jellyfin</span><span>{jellyfin.data?.connected ? "Connected" : "Not connected"}</span></div><div><span>Live TV</span><span>{iptv.data?.sources.length ? `${iptv.data.sources.length} source${iptv.data.sources.length === 1 ? "" : "s"} · ${iptv.data.sources.some(source => source.error) ? "Needs attention" : "Ready"}` : "Not set up"}</span></div><div><span>Radio</span><span>avoid radio, built in</span></div>{onAddSource && <Button variant="outline" onClick={onAddSource}>Add a source</Button>}</div> : <p>An administrator can add TV folders, Jellyfin or Live TV in Settings.</p>}
    </EmptyContent></Empty>}
  </section>;
}
