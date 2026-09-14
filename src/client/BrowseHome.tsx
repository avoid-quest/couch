import { useEffect, useRef, useState } from "react";
import { ChevronRight, Film, Play, Plus, RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { HistoryItem, LibraryItem } from "../shared/library";
import type { ProviderId } from "../shared/providers";
import type { SessionState } from "../shared/protocol";
import { AuthArtwork } from "./AuthArtwork";
import { MediaArtwork } from "./ProviderPanel";
import { progressTime, type HistoryPlayback } from "./HistoryPanel";
import type { Credentials } from "./session";
import { SaveForLater } from "./SaveForLater";
import "./browse-home.css";

const sources = [{ section: "Radio", label: "Radio directory & playlists" }, { section: "Guide", label: "Live TV" }, { section: "Jellyfin", label: "Jellyfin" }, { section: "Library", label: "Local library" }, { section: "Files", label: "Local files" }];
const asHistory = (item: LibraryItem): HistoryItem => ({
  mediaId: `library:${item.id}`, libraryItemId: item.id, title: item.title,
  position: item.progress?.position ?? 0, duration: item.progress?.duration ?? item.duration,
  watched: item.progress?.watched ?? false, lastPlayedAt: item.progress?.lastPlayedAt ?? null,
});

export function BrowseHome({ state, credentials, connected, canPlay, active, onBrowse, onProvider, onAddSource, onPlay, onAdd }: {
  state: SessionState | null;
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  playing: boolean;
  active: boolean;
  onBrowse: (section: string) => void;
  onProvider?: (provider: ProviderId) => void;
  onAddSource?: () => void;
  onPlay: HistoryPlayback;
  onAdd: (item: HistoryItem) => Promise<boolean>;
}) {
  const { origin, token } = credentials;
  const profileId = state?.activeProfile.id;
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [loadedProfile, setLoadedProfile] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [detail, setDetail] = useState<HistoryItem | null>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => { setDetail(null); setNotice(null); }, [origin, token, profileId]);

  useEffect(() => {
    if (!connected || !active) return;
    const controller = new AbortController();
    setLoading(true); setError(null);
    const read = async (path: string) => {
      const response = await fetch(`${origin}${path}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load your media.");
      return result;
    };
    void Promise.allSettled([read("/api/progress/history?limit=40"), read("/api/library/items?limit=24")]).then(([recent, catalog]) => {
      if (controller.signal.aborted) return;
      setHistory(recent.status === "fulfilled" ? recent.value.items : []);
      setLibrary(catalog.status === "fulfilled" ? catalog.value.items : []);
      const failures = [recent, catalog].filter(result => result.status === "rejected");
      setError(failures.map(result => result.reason instanceof Error ? result.reason.message : "Could not load your media.").filter((message, index, all) => all.indexOf(message) === index).join(" ") || null);
      setLoadedProfile(profileId); setLoading(false);
    });
    return () => controller.abort();
  }, [origin, token, connected, active, profileId, state?.libraryVersion, refresh]);

  const currentProfile = loadedProfile === profileId;
  const unfinished = currentProfile ? history.filter(item => item.position > 0 && !item.watched) : [];
  const hero = unfinished[0];
  const cards = currentProfile ? library.filter(item => item.id !== hero?.libraryItemId).slice(0, 3) : [];
  const metadata = (item: HistoryItem) => library.find(entry => entry.id === item.libraryItemId);
  const playable = (item: HistoryItem) => connected && canPlay && currentProfile && !loading && !pending && !!(item.playable || item.libraryItemId || item.queueEntryId) && metadata(item)?.available !== false;
  const openDetail = (item: HistoryItem, trigger: HTMLElement) => { detailTrigger.current = trigger; setDetail(item); };
  const play = async (item: HistoryItem, fromStart = false) => {
    setPending(true); setNotice(null); setError(null);
    try {
      if (await onPlay(item, { fromStart })) { setNotice(`${fromStart || !item.position ? "Starting" : "Resuming"} ${item.title} on the playback computer.`); setDetail(null); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not play this item."); }
    finally { setPending(false); }
  };
  const add = async (item: HistoryItem) => {
    setPending(true); setNotice(null); setError(null);
    try { if (await onAdd(item)) setNotice(`Added ${item.title} to Up next.`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add this item to Up next."); }
    finally { setPending(false); }
  };
  const artwork = (item: HistoryItem, className = "") => {
    const media = metadata(item);
    const id = media?.video?.fanartId || media?.artworkId || item.artworkId;
    return <span className={`browse-art ${className}`}>
      {id ? <AuthArtwork origin={origin} token={token} id={id} video={media?.kind !== "audio"} className="browse-image" /> : item.thumbnail ? <MediaArtwork thumbnail={item.thumbnail} title={item.title} className="browse-image" /> : <><Film aria-hidden="true" /><span>{item.title}</span></>}
      {item.position > 0 && !!item.duration && <span className="browse-progress" aria-label={`${Math.round(Math.min(1, item.position / item.duration) * 100)}% watched`}><i style={{ width: `${Math.min(1, item.position / item.duration) * 100}%` }} /></span>}
    </span>;
  };
  const playbackActions = (item: HistoryItem) => <div className="browse-actions">
    <Button disabled={!playable(item)} aria-label={`${item.position ? "Resume" : item.watched ? "Play again" : "Play now"} ${item.title}`} onClick={() => void play(item)}><Play aria-hidden="true" />{pending ? "Starting…" : item.position ? "Resume" : item.watched ? "Play again" : "Play now"}</Button>
    {item.position > 0 && <Button variant="outline" disabled={!playable(item)} aria-label={`Play ${item.title} from start`} onClick={() => void play(item, true)}><RotateCcw aria-hidden="true" />From start</Button>}
    {item.libraryItemId && <Button variant="outline" disabled={!connected || !currentProfile || loading || pending || metadata(item)?.available === false} aria-label={`Add to queue: ${item.title}`} onClick={() => void add(item)}><Plus aria-hidden="true" />Add to queue</Button>}
    {(item.libraryItemId || item.queueEntryId) && <SaveForLater origin={origin} token={token} connected={connected && currentProfile && !loading} reference={item.libraryItemId ? { kind: "library", id: item.libraryItemId } : { kind: "queue", id: item.queueEntryId! }} title={item.title} />}
  </div>;
  const selected = detail && metadata(detail);

  return <section className="browse-home" aria-label="Browse and resume">
    <div className="browse-section-heading"><h2>Sources</h2>{onAddSource && <Button variant="ghost" onClick={onAddSource}><Plus aria-hidden="true" />Add source</Button>}</div>
    <nav className="browse-sources" aria-label="Browse sources"><div>{([['youtube', 'YouTube'], ['twitch', 'Twitch'], ['raiplay', 'RaiPlay'], ['bandcamp', 'Bandcamp']] as const).map(([provider, label]) => <Button key={provider} variant="outline" onClick={() => onProvider ? onProvider(provider) : onBrowse("Online")}>{label}</Button>)}{sources.map(({ section, label }) => <Button key={section} variant="outline" onClick={() => onBrowse(section)}>{label}</Button>)}</div></nav>
    {error && <Alert variant="destructive"><AlertDescription>{error}<Button variant="outline" disabled={!connected || loading} onClick={() => setRefresh(value => value + 1)}>Try again</Button></AlertDescription></Alert>}
    {notice && <p role="status" className="browse-notice">{notice}</p>}
    {loading && connected && <p role="status" className="browse-quiet">Loading your media…</p>}
    {hero && <div className="browse-section-heading"><h2>Continue playing</h2></div>}
    {hero ? <section className="browse-hero" aria-label="Continue watching">
      {artwork(hero, "browse-hero-art")}
      <div className="browse-hero-copy"><p className="browse-eyebrow">{hero.sourceLabel || (hero.libraryItemId ? "TV folders" : "Recently played")}</p><h2>{hero.title}</h2><p>{progressTime(hero.position)} watched{hero.duration ? ` of ${progressTime(hero.duration)}` : ""}</p>
        <div className="browse-actions"><Button disabled={!playable(hero)} aria-label={`Resume ${hero.title}`} onClick={() => void play(hero)}><Play aria-hidden="true" />{pending ? "Starting…" : "Resume"}</Button><Button variant="outline" onClick={event => openDetail(hero, event.currentTarget)}>Details</Button></div>
      </div>
    </section> : null}
    {currentProfile && history.some(item => item.mediaId !== hero?.mediaId) && <section aria-label="Recently played">
      <div className="browse-section-heading"><h2>Recently played</h2></div>
      <ul className="browse-media-grid">{history.filter(item => item.mediaId !== hero?.mediaId).map(item => <li key={item.mediaId}>
        <button type="button" className="browse-media-card" aria-label={`Details for ${item.title}`} onClick={event => openDetail(item, event.currentTarget)}>
          {artwork(item)}<strong>{item.title}</strong><small>{item.position > 0 ? `Continue at ${progressTime(item.position)}` : item.watched ? "Finished" : item.sourceLabel || "Played"}</small>
        </button>{playbackActions(item)}
      </li>)}</ul>
    </section>}
    {!!cards.length && <div className="browse-section-heading"><h2>TV folders</h2><Button variant="ghost" onClick={() => onBrowse("Files")}>View all<ChevronRight aria-hidden="true" /></Button></div>}
    {!!cards.length && <ul className="browse-media-grid">{cards.map(item => {
      const entry = asHistory(item);
      return <li key={item.id}><button type="button" className="browse-media-card" aria-label={`Details for ${item.title}`} onClick={event => openDetail(entry, event.currentTarget)}>{artwork(entry)}<strong>{item.title}</strong><small>{[item.video?.year, item.kind === "audio" ? item.artist || "Music" : item.video?.show?.title || "Local video", !item.available ? "File unavailable" : item.progress?.watched ? "Watched" : item.progress?.position ? `Resume at ${progressTime(item.progress.position)}` : null].filter(Boolean).join(" · ")}</small></button>{playbackActions(entry)}</li>;
    })}</ul>}
    <Dialog open={active && currentProfile && detail !== null} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent className="browse-detail" onCloseAutoFocus={event => { event.preventDefault(); if (active && detailTrigger.current?.isConnected) detailTrigger.current.focus(); }}>
      {detail && <>{artwork(detail)}<DialogHeader><DialogTitle>{detail.title}</DialogTitle><DialogDescription>{[selected?.video?.year, selected?.video?.genres.join(" · "), selected?.artist].filter(Boolean).join(" · ") || detail.sourceLabel || (detail.libraryItemId ? "TV folders" : "Recently played")}</DialogDescription></DialogHeader>
        {selected?.video?.plot && <p>{selected.video.plot}</p>}
        {detail.playedBy && <p className="browse-quiet">Started from {detail.playedBy.name}</p>}
        {detail.position > 0 && <p className="browse-quiet">Continue from {progressTime(detail.position)}{detail.duration ? ` of ${progressTime(detail.duration)}` : ""}</p>}
        {!detail.playable && !detail.libraryItemId && !detail.queueEntryId && <p>Open this file again on the TV to play it. Your resume point is saved.</p>}
        {selected?.available === false && <p>This file is unavailable. Check its TV folder.</p>}
        {playbackActions(detail)}
        {notice && <p role="status" className="browse-notice">{notice}</p>}
        {error && <p role="alert">{error}</p>}
      </>}
    </DialogContent></Dialog>
  </section>;
}
