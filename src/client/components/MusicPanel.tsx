import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Play, Plus, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MusicAlbums, MusicArtist, MusicArtists } from "../../shared/library";
import { AuthArtwork } from "@/components/AuthArtwork";
import { progressTime } from "@/components/HistoryPanel";
import { musicBrowseQuery, musicPageSize, type AlbumTracks, type MusicBrowse } from "@/api/library";

type Props = {
  origin: string;
  token: string;
  connected: boolean;
  canPlay: boolean;
  view: "artists" | "albums";
  active: boolean;
  onEnqueue: (id: string, options?: { playNow?: boolean; fromStart?: boolean }) => Promise<boolean>;
  onQueueAlbum: (albumId: string, playNow: boolean) => Promise<boolean>;
  onArtistTracks: (artist: MusicArtist) => void;
};

export function MusicPanel({ origin, token, connected, canPlay, view, active, onEnqueue, onQueueAlbum, onArtistTracks }: Props) {
  const [browse, setBrowse] = useState<MusicBrowse>({ kind: view, q: "", offset: 0 });
  const [trail, setTrail] = useState<{ browse: MusicBrowse; draft: string; focus: string; scrollTop: number; scrollLeft: number }[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const restoreFocus = useRef<string | null>(null);
  const restoreScroll = useRef<{ scrollTop: number; scrollLeft: number } | null>(null);
  const scrollContainer = () => panel.current?.closest(".tv-browser") ?? document.scrollingElement;
  const queryId = useId();
  const { data: result, isPending, isFetching, error, refetch } = useQuery({
    ...musicBrowseQuery({ origin, token, installationId: "" }, browse),
    enabled: connected && active,
  });
  const busy = isFetching;
  const detail = browse.kind === "album" && result && "items" in result ? result as AlbumTracks : null;
  const artists = browse.kind === "artists" ? result as MusicArtists | undefined : undefined;
  const albums = browse.kind === "albums" ? result as MusicAlbums | undefined : undefined;

  const restore = () => {
    if (busy || isPending || !active || !restoreFocus.current || panel.current?.closest("[hidden]")) return;
    if (document.querySelector('[role="dialog"], [role="listbox"], [data-slot="popover-content"]')) return;
    panel.current?.querySelector<HTMLButtonElement>(restoreFocus.current)?.focus({ preventScroll: restoreScroll.current !== null });
    const container = scrollContainer();
    if (container && restoreScroll.current) {
      container.scrollTop = restoreScroll.current.scrollTop;
      container.scrollLeft = restoreScroll.current.scrollLeft;
    }
    restoreScroll.current = null;
    restoreFocus.current = null;
  };

  useEffect(() => { restore(); }, [busy, isPending, active]);

  const open = (next: MusicBrowse, focus: string) => {
    const container = scrollContainer();
    setTrail(value => [...value, { browse, draft, focus, scrollTop: container?.scrollTop ?? 0, scrollLeft: container?.scrollLeft ?? 0 }]);
    setBrowse(next);
    setDraft("");
    setNotice(null);
    setActionError(null);
    restoreFocus.current = "[data-back]";
  };
  const back = () => {
    const previous = trail.at(-1);
    if (!previous) return;
    setBrowse(previous.browse);
    setDraft(previous.draft);
    setTrail(value => value.slice(0, -1));
    setNotice(null);
    setActionError(null);
    restoreFocus.current = previous.focus;
    restoreScroll.current = previous;
  };
  const search = (event: FormEvent) => {
    event.preventDefault();
    setBrowse(value => ({ ...value, q: draft.trim(), offset: 0 }));
  };
  const queue = async (title: string, action: () => Promise<boolean>, playNow: boolean) => {
    setPending(true);
    setActionError(null);
    setNotice(null);
    try {
      if (await action()) setNotice(playNow ? `Starting ${title} on the TV.` : `Added ${title} to the queue.`);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not queue this music.");
    } finally { setPending(false); }
  };
  const searchLabel = browse.kind === "album" ? "Filter album tracks" : `Search ${browse.kind}`;
  const total = browse.kind === "artists" ? artists?.total ?? 0 : browse.kind === "albums" ? albums?.total ?? 0 : detail?.items.length ?? 0;
  const tracks = detail?.items.filter(item => [item.title, ...(item.artists ?? []), item.artist].filter(Boolean).join(" ").toLocaleLowerCase().includes(browse.q.toLocaleLowerCase())) ?? [];

  return <section ref={panel} className="min-w-0 space-y-4" aria-label={view === "artists" ? "Music artists" : "Music albums"} aria-busy={busy && active}>
    <div className="flex flex-wrap items-center gap-3">
      {trail.length > 0 && <Button data-back variant="ghost" onClick={back}><ArrowLeft aria-hidden="true" />Back</Button>}
      <div className="min-w-0 flex-1"><h3 className="break-words text-xl font-semibold">{browse.kind === "album" ? browse.album.title : browse.kind === "albums" && browse.artist ? browse.artist.name : view === "artists" ? "Artists" : "Albums"}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{browse.kind === "album" ? "In disc and track order" : browse.kind === "albums" && browse.artist ? `${browse.artist.trackCount} tracks in your library` : "Your music collection"}</p>
      </div>
    </div>
    {browse.kind === "albums" && browse.artist && <Button variant="secondary" data-music-artist-tracks className="h-auto max-w-full min-h-11 flex-wrap justify-start whitespace-normal py-2.5" aria-label={`View all tracks by ${browse.artist.name}`} disabled={!connected} onClick={() => onArtistTracks(browse.artist!)}><ArrowUpRight aria-hidden="true" />View all tracks<span className="text-xs font-normal text-muted-foreground">including singles</span></Button>}
    <form className="flex w-full items-end gap-2" role="search" onSubmit={search}>
      <div className="min-w-0 flex-1"><Label htmlFor={queryId} className="sr-only">{searchLabel}</Label><Input id={queryId} type="search" aria-label={searchLabel} placeholder={searchLabel} maxLength={200} value={draft} disabled={!connected} onChange={event => setDraft(event.target.value)} /></div>
      <Button type="submit" variant="secondary" size="icon" aria-label={browse.kind === "album" ? "Filter" : "Search"} disabled={!connected || busy}><Search aria-hidden="true" /></Button>
    </form>
    {error && <Alert variant="destructive"><AlertDescription className="space-y-3"><p>{error.message}</p><Button variant="outline" disabled={!connected || busy} onClick={() => void refetch()}>Try again</Button></AlertDescription></Alert>}
    {actionError && <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert>}
    {notice && <p className="text-sm text-primary" role="status">{notice}</p>}
    {!connected && <p className="text-sm text-muted-foreground" role="status">Reconnect to this player to browse and queue music.</p>}
    {busy && connected && !error && <p className="text-sm text-muted-foreground" role="status">Loading music…</p>}
    {!busy && browse.kind !== "album" && <p className="text-sm text-muted-foreground" aria-live="polite">{total} {browse.kind === "artists" ? total === 1 ? "artist" : "artists" : total === 1 ? "album" : "albums"}</p>}
    {!busy && total === 0 && <Card className="p-5 text-sm leading-relaxed text-muted-foreground">{browse.q ? "No matching music. Try another title or artist." : browse.kind === "albums" && browse.artist ? "No albums for this artist. View all tracks to find their singles." : "No tagged music found here. Add a music folder on the TV, or rescan an existing folder."}</Card>}
    {!busy && browse.kind === "artists" && <ul className="grid list-none gap-3 p-0 [grid-template-columns:repeat(auto-fill,minmax(min(100%,18rem),1fr))]">
      {artists?.items.map(artist => <li key={artist.id} className="min-w-0"><Button variant="ghost" className="h-full w-full min-h-22 justify-start border p-2.5 text-left whitespace-normal" data-music-artist={artist.id} aria-label={`Browse ${artist.name} albums`} disabled={!connected} onClick={() => open({ kind: "albums", artist, q: "", offset: 0 }, `[data-music-artist="${CSS.escape(artist.id)}"]`)}>
        <AuthArtwork origin={origin} token={token} id={artist.artworkId} className="rounded-full" /><span className="min-w-0"><strong className="block break-words text-base font-medium">{artist.name}</strong><span className="mt-1 block text-sm font-normal text-muted-foreground">{artist.albumCount > 0 && `${artist.albumCount} album${artist.albumCount === 1 ? "" : "s"} · `}{artist.trackCount} track{artist.trackCount === 1 ? "" : "s"}</span></span><ArrowUpRight className="ml-auto text-muted-foreground" aria-hidden="true" />
      </Button></li>)}
    </ul>}
    {!busy && browse.kind === "albums" && <ul className="grid list-none gap-3 p-0 [grid-template-columns:repeat(auto-fill,minmax(min(100%,9rem),1fr))]">
      {albums?.items.map(album => <li key={album.id} className="min-w-0"><Button variant="ghost" className="h-full w-full flex-col items-stretch gap-2.5 p-2 text-left whitespace-normal" data-music-album={album.id} aria-label={`Browse ${album.title}`} disabled={!connected} onClick={() => open({ kind: "album", album, q: "", offset: 0 }, `[data-music-album="${CSS.escape(album.id)}"]`)}>
        <AuthArtwork origin={origin} token={token} id={album.artworkId} className="aspect-square w-full rounded-lg [&>svg]:mx-auto [&>svg]:size-[30%]" /><span className="min-w-0 w-full"><strong className="block break-words text-base font-medium [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{album.title}</strong><span className="mt-1 block break-words text-sm font-normal text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{album.artist || "Unknown artist"}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{album.trackCount} track{album.trackCount === 1 ? "" : "s"}{album.duration !== null && ` · ${progressTime(album.duration)}`}</span></span>
      </Button></li>)}
    </ul>}
    {!busy && browse.kind === "album" && detail && <div className="music-album-detail space-y-4">
      <Card className="grid gap-4 bg-muted/50 p-4">
        <div className="flex min-w-0 items-center gap-4"><AuthArtwork origin={origin} token={token} id={detail.album.artworkId} className="size-24" /><div className="min-w-0"><p className="break-words text-base font-medium">{detail.album.artist || "Unknown artist"}</p><p className="mt-1 text-sm text-muted-foreground">{detail.album.trackCount} track{detail.album.trackCount === 1 ? "" : "s"}{detail.album.duration !== null && ` · ${progressTime(detail.album.duration)}`}</p></div></div>
        <div className="flex max-w-70 flex-wrap gap-2"><Button className="min-w-36 flex-1" aria-label="Play album on TV" disabled={!connected || !canPlay || pending || !detail.items.length || detail.items.some(item => !item.available)} onClick={() => void queue(detail.album.title, () => onQueueAlbum(detail.album.id, true), true)}><Play aria-hidden="true" />Play album</Button><Button className="min-w-36 flex-1" variant="secondary" aria-label="Add album to queue" disabled={!connected || pending || !detail.items.length || detail.items.some(item => !item.available)} onClick={() => void queue(detail.album.title, () => onQueueAlbum(detail.album.id, false), false)}><Plus aria-hidden="true" />Queue album</Button></div>
        {detail.items.some(item => !item.available) && <p className="text-sm text-muted-foreground">Some files are unavailable. Reconnect the library folder to queue the whole album.</p>}
      </Card>
      {!tracks.length && !!detail.items.length && <p className="text-sm text-muted-foreground">No matching tracks. Clear the filter to see the whole album.</p>}
      <ol className="space-y-2">{tracks.map((item, index) => <li key={item.id}><Card className="grid items-center gap-3 p-3">
        <div className="flex min-w-0 items-center gap-3"><span className="grid w-7 min-h-9 shrink-0 place-items-center text-sm tabular-nums text-muted-foreground" aria-hidden="true">{item.trackNumber ?? index + 1}</span><div className="min-w-0 flex-1"><strong className="block break-words text-base font-medium">{item.title}</strong><p className="mt-1 break-words text-sm text-muted-foreground">{item.discNumber != null && <span data-disc-number={item.discNumber}>Disc {item.discNumber} · </span>}{item.trackNumber != null && <span data-track-number={item.trackNumber} className="sr-only">Track {item.trackNumber} · </span>}{item.artists?.join(", ") || item.artist || "Unknown artist"}{item.duration !== null && ` · ${progressTime(item.duration)}`}{!item.available && " · File unavailable"}</p></div></div>
        <div className="flex flex-wrap gap-2"><Button aria-label={`Play ${item.title}`} disabled={!connected || !canPlay || pending || !item.available} onClick={() => void queue(item.title, () => onEnqueue(item.id, { playNow: true, fromStart: true }), true)}><Play aria-hidden="true" />Play</Button><Button variant="secondary" aria-label={`Add ${item.title} to queue`} disabled={!connected || pending || !item.available} onClick={() => void queue(item.title, () => onEnqueue(item.id), false)}><Plus aria-hidden="true" />Queue</Button></div>
      </Card></li>)}</ol>
    </div>}
    {!busy && browse.kind !== "album" && total > musicPageSize && <nav className="flex items-center justify-between gap-2" aria-label="Music pages"><Button variant="outline" disabled={!connected || !browse.offset} onClick={() => setBrowse(value => ({ ...value, offset: Math.max(0, value.offset - musicPageSize) }))}>Previous</Button><span className="text-center text-sm text-muted-foreground">{browse.offset + 1}–{Math.min(browse.offset + musicPageSize, total)} of {total}</span><Button variant="outline" disabled={!connected || browse.offset + musicPageSize >= total} onClick={() => setBrowse(value => ({ ...value, offset: value.offset + musicPageSize }))}>Next</Button></nav>}
  </section>;
}
