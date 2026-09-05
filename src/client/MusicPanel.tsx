import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, Play, Plus, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LibraryItem, MusicAlbum, MusicAlbums, MusicArtist, MusicArtists } from "../shared/library";
import { AuthArtwork } from "./AuthArtwork";
import { progressTime } from "./HistoryPanel";
import "./music-library.css";

const pageSize = 24;
type Browse = { kind: "artists" | "albums"; artist?: MusicArtist; q: string; offset: number } | { kind: "album"; album: MusicAlbum; q: string; offset: number };
type AlbumTracks = { album: MusicAlbum; items: LibraryItem[] };

export function MusicPanel({ origin, token, connected, canPlay, version, view, active, onEnqueue, onQueueAlbum, onArtistTracks }: {
  origin: string;
  token: string;
  connected: boolean;
  canPlay: boolean;
  version: number;
  view: "artists" | "albums";
  active: boolean;
  onEnqueue: (id: string, options?: { playNow?: boolean; fromStart?: boolean }) => Promise<boolean>;
  onQueueAlbum: (albumId: string, playNow: boolean) => Promise<boolean>;
  onArtistTracks: (artist: MusicArtist) => void;
}) {
  const [browse, setBrowse] = useState<Browse>({ kind: view, q: "", offset: 0 });
  const [trail, setTrail] = useState<{ browse: Browse; draft: string; focus: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [artists, setArtists] = useState<MusicArtists | null>(null);
  const [albums, setAlbums] = useState<MusicAlbums | null>(null);
  const [detail, setDetail] = useState<AlbumTracks | null>(null);
  const [dataPath, setDataPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const restoreFocus = useRef<string | null>(null);
  const queryId = useId();
  const params = new URLSearchParams({ q: browse.q, offset: String(browse.offset), limit: String(pageSize) });
  if (browse.kind === "albums" && browse.artist) params.set("artistId", browse.artist.id);
  const path = browse.kind === "album" ? `/api/library/music/albums/${encodeURIComponent(browse.album.id)}` : `/api/library/music/${browse.kind}?${params}`;
  const busy = dataPath !== path;

  useEffect(() => {
    if (!connected || !active) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`${origin}${path}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load your music.");
      if (controller.signal.aborted) return;
      if (browse.kind === "artists") setArtists(result);
      else if (browse.kind === "albums") setAlbums(result);
      else setDetail(result);
      setDataPath(path);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load your music.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [origin, token, connected, active, path, browse.kind, version, refresh]);

  useEffect(() => {
    if (busy || loading || !active || !restoreFocus.current || panel.current?.closest("[hidden]")) return;
    if (document.querySelector('[role="dialog"], [role="listbox"], [data-slot="popover-content"]')) return;
    panel.current?.querySelector<HTMLButtonElement>(restoreFocus.current)?.focus();
    restoreFocus.current = null;
  }, [busy, loading, active, dataPath]);

  const open = (next: Browse, focus: string) => {
    setTrail(value => [...value, { browse, draft, focus }]);
    setBrowse(next);
    setDraft("");
    setNotice(null);
    setError(null);
    restoreFocus.current = "[data-back]";
  };
  const back = () => {
    const previous = trail.at(-1);
    if (!previous) return;
    setBrowse(previous.browse);
    setDraft(previous.draft);
    setTrail(value => value.slice(0, -1));
    setNotice(null);
    setError(null);
    restoreFocus.current = previous.focus;
  };
  const search = (event: FormEvent) => {
    event.preventDefault();
    setBrowse(value => ({ ...value, q: draft.trim(), offset: 0 }));
    if (browse.kind !== "album") setRefresh(value => value + 1);
  };
  const queue = async (title: string, action: () => Promise<boolean>, playNow: boolean) => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      if (await action()) setNotice(playNow ? `Starting ${title} on the TV.` : `Added ${title} to the queue.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not queue this music."); }
    finally { setPending(false); }
  };
  const searchLabel = browse.kind === "album" ? "Filter album tracks" : `Search ${browse.kind}`;
  const total = browse.kind === "artists" ? artists?.total ?? 0 : browse.kind === "albums" ? albums?.total ?? 0 : detail?.items.length ?? 0;
  const tracks = detail?.items.filter(item => [item.title, ...(item.artists ?? []), item.artist].filter(Boolean).join(" ").toLocaleLowerCase().includes(browse.q.toLocaleLowerCase())) ?? [];

  return <section ref={panel} className="music-panel space-y-4" aria-label={view === "artists" ? "Music artists" : "Music albums"} aria-busy={loading && active}>
    <div className="music-heading flex flex-wrap items-center gap-3">
      {trail.length > 0 && <Button data-back variant="ghost" onClick={back}><ArrowLeft aria-hidden="true" />Back</Button>}
      <div className="min-w-0 flex-1"><h3 className="break-words text-xl font-semibold">{browse.kind === "album" ? browse.album.title : browse.kind === "albums" && browse.artist ? browse.artist.name : view === "artists" ? "Artists" : "Albums"}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{browse.kind === "album" ? "In disc and track order" : browse.kind === "albums" && browse.artist ? `${browse.artist.trackCount} tracks in your library` : "Your music collection"}</p>
      </div>
    </div>
    {browse.kind === "albums" && browse.artist && <Button variant="secondary" className="music-artist-tracks" data-music-artist-tracks aria-label={`View all tracks by ${browse.artist.name}`} disabled={!connected} onClick={() => onArtistTracks(browse.artist!)}><ArrowUpRight aria-hidden="true" />View all tracks<span className="font-normal text-muted-foreground">including singles</span></Button>}
    <form className="music-search flex items-end gap-2" role="search" onSubmit={search}>
      <div className="min-w-0 flex-1"><Label htmlFor={queryId} className="sr-only">{searchLabel}</Label><Input id={queryId} type="search" aria-label={searchLabel} placeholder={searchLabel} maxLength={200} value={draft} disabled={!connected} onChange={event => setDraft(event.target.value)} /></div>
      <Button type="submit" variant="secondary" size="icon" aria-label={browse.kind === "album" ? "Filter" : "Search"} disabled={!connected || loading}><Search aria-hidden="true" /></Button>
    </form>
    {error && <Alert variant="destructive"><AlertDescription className="space-y-3"><p>{error}</p><Button variant="outline" disabled={!connected || loading} onClick={() => setRefresh(value => value + 1)}>Try again</Button></AlertDescription></Alert>}
    {notice && <p className="text-sm text-primary" role="status">{notice}</p>}
    {!connected && <p className="text-sm text-muted-foreground" role="status">Reconnect to this player to browse and queue music.</p>}
    {busy && connected && !error && <p className="text-sm text-muted-foreground" role="status">Loading music…</p>}
    {!busy && browse.kind !== "album" && <p className="text-sm text-muted-foreground" aria-live="polite">{total} {browse.kind === "artists" ? total === 1 ? "artist" : "artists" : total === 1 ? "album" : "albums"}</p>}
    {!busy && total === 0 && <Card className="p-5 text-sm leading-relaxed text-muted-foreground">{browse.q ? "No matching music. Try another title or artist." : browse.kind === "albums" && browse.artist ? "No albums for this artist. View all tracks to find their singles." : "No tagged music found here. Add a music folder on the TV, or rescan an existing folder."}</Card>}
    {!busy && browse.kind === "artists" && <ul className="music-artists">{artists?.items.map(artist => <li key={artist.id}><Button variant="ghost" className="music-artist-card" data-music-artist={artist.id} aria-label={`Browse ${artist.name} albums`} disabled={!connected} onClick={() => open({ kind: "albums", artist, q: "", offset: 0 }, `[data-music-artist="${CSS.escape(artist.id)}"]`)}>
      <AuthArtwork origin={origin} token={token} id={artist.artworkId} /><span className="min-w-0"><strong className="block break-words text-base font-medium">{artist.name}</strong><span className="mt-1 block text-sm font-normal text-muted-foreground">{artist.albumCount > 0 && `${artist.albumCount} album${artist.albumCount === 1 ? "" : "s"} · `}{artist.trackCount} track{artist.trackCount === 1 ? "" : "s"}</span></span><ArrowUpRight className="ml-auto text-muted-foreground" aria-hidden="true" />
    </Button></li>)}</ul>}
    {!busy && browse.kind === "albums" && <ul className="music-albums">{albums?.items.map(album => <li key={album.id}><Button variant="ghost" className="music-album-card" data-music-album={album.id} aria-label={`Browse ${album.title}`} disabled={!connected} onClick={() => open({ kind: "album", album, q: "", offset: 0 }, `[data-music-album="${CSS.escape(album.id)}"]`)}>
      <AuthArtwork origin={origin} token={token} id={album.artworkId} /><span className="min-w-0 w-full"><strong className="music-card-title block break-words text-base font-medium">{album.title}</strong><span className="music-card-title mt-1 block break-words text-sm font-normal text-muted-foreground">{album.artist || "Unknown artist"}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{album.trackCount} track{album.trackCount === 1 ? "" : "s"}{album.duration !== null && ` · ${progressTime(album.duration)}`}</span></span>
    </Button></li>)}</ul>}
    {!busy && browse.kind === "album" && detail && <div className="music-album-detail space-y-4">
      <Card className="music-album-summary gap-4 p-4"><div className="flex min-w-0 items-center gap-4"><AuthArtwork origin={origin} token={token} id={detail.album.artworkId} className="size-24" /><div className="min-w-0"><p className="break-words text-base font-medium">{detail.album.artist || "Unknown artist"}</p><p className="mt-1 text-sm text-muted-foreground">{detail.album.trackCount} track{detail.album.trackCount === 1 ? "" : "s"}{detail.album.duration !== null && ` · ${progressTime(detail.album.duration)}`}</p></div></div>
        <div className="music-album-actions flex flex-wrap gap-2"><Button className="music-album-play" aria-label="Play album on TV" disabled={!connected || !canPlay || pending || !detail.items.length || detail.items.some(item => !item.available)} onClick={() => void queue(detail.album.title, () => onQueueAlbum(detail.album.id, true), true)}><Play aria-hidden="true" />Play album</Button><Button className="music-album-queue" aria-label="Add album to queue" variant="secondary" disabled={!connected || pending || !detail.items.length || detail.items.some(item => !item.available)} onClick={() => void queue(detail.album.title, () => onQueueAlbum(detail.album.id, false), false)}><Plus aria-hidden="true" />Queue album</Button></div>
        {detail.items.some(item => !item.available) && <p className="text-sm text-muted-foreground">Some files are unavailable. Reconnect the library folder to queue the whole album.</p>}
      </Card>
      {!tracks.length && !!detail.items.length && <p className="text-sm text-muted-foreground">No matching tracks. Clear the filter to see the whole album.</p>}
      <ol className="music-tracks space-y-2">{tracks.map((item, index) => <li key={item.id}><Card className="catalog-row music-track-row gap-3 p-3">
        <div className="catalog-row-main flex min-w-0 items-center gap-3"><span className="music-track-number" aria-hidden="true">{item.trackNumber ?? index + 1}</span><div className="min-w-0 flex-1"><strong className="block break-words text-base font-medium">{item.title}</strong><p className="mt-1 break-words text-sm text-muted-foreground">{item.discNumber != null && <span data-disc-number={item.discNumber}>Disc {item.discNumber} · </span>}{item.trackNumber != null && <span data-track-number={item.trackNumber} className="sr-only">Track {item.trackNumber} · </span>}{item.artists?.join(", ") || item.artist || "Unknown artist"}{item.duration !== null && ` · ${progressTime(item.duration)}`}{!item.available && " · File unavailable"}</p></div></div>
        <div className="catalog-row-actions flex flex-wrap gap-2"><Button className="music-track-play" aria-label={`Play ${item.title}`} disabled={!connected || !canPlay || pending || !item.available} onClick={() => void queue(item.title, () => onEnqueue(item.id, { playNow: true, fromStart: true }), true)}><Play aria-hidden="true" />Play</Button><Button className="music-track-queue" variant="secondary" aria-label={`Add ${item.title} to queue`} disabled={!connected || pending || !item.available} onClick={() => void queue(item.title, () => onEnqueue(item.id), false)}><Plus aria-hidden="true" />Queue</Button></div>
      </Card></li>)}</ol>
    </div>}
    {!busy && browse.kind !== "album" && total > pageSize && <nav className="music-pages flex items-center justify-between gap-2" aria-label="Music pages"><Button variant="outline" disabled={!connected || !browse.offset} onClick={() => setBrowse(value => ({ ...value, offset: Math.max(0, value.offset - pageSize) }))}>Previous</Button><span className="text-center text-sm text-muted-foreground">{browse.offset + 1}–{Math.min(browse.offset + pageSize, total)} of {total}</span><Button variant="outline" disabled={!connected || browse.offset + pageSize >= total} onClick={() => setBrowse(value => ({ ...value, offset: value.offset + pageSize }))}>Next</Button></nav>}
  </section>;
}
