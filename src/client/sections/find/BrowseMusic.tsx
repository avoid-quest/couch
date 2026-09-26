import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { AuthArtwork } from "@/components/AuthArtwork";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { DurationBar } from "@/components/DurationBar";
import { MediaList, MediaRow } from "@/components/MediaRow";
import { PageHeader } from "@/components/PageHeader";
import { musicAlbumQuery, musicAlbumsQuery, musicArtistsQuery, musicPageSize } from "@/api/library";
import { playNotice } from "@/copy";
import { formatDuration } from "@/time-format";
import type { MusicAlbum, MusicArtist } from "../../../shared/library";
import type { Credentials } from "../../session/session";

type View = { kind: "artists"; offset: number } | { kind: "albums"; offset: number; artist?: MusicArtist; artistOffset?: number } | { kind: "album"; album: MusicAlbum; offset: number; artist?: MusicArtist; artistOffset?: number };

export function BrowseMusic({ credentials, connected, canPlay, active, onBack, onAlbum, onTrack }: {
  credentials: Credentials; connected: boolean; canPlay: boolean; active: boolean; onBack: () => void;
  onAlbum: (id: string, playNow: boolean) => Promise<boolean>;
  onTrack: (id: string, playNow: boolean) => Promise<boolean>;
}) {
  const navigate = useNavigate();
  const [view, setView] = useState<View>({ kind: "artists", offset: 0 });
  const [busy, setBusy] = useState(false);
  const artists = useQuery({ ...musicArtistsQuery(credentials, view.offset), enabled: connected && active && view.kind === "artists" });
  const albums = useQuery({ ...musicAlbumsQuery(credentials, view.offset, view.kind !== "artists" ? view.artist?.id : undefined), enabled: connected && active && view.kind === "albums" });
  const detail = useQuery({ ...musicAlbumQuery(credentials, view.kind === "album" ? view.album.id : ""), enabled: connected && active && view.kind === "album" });
  const query = view.kind === "artists" ? artists : view.kind === "albums" ? albums : detail;
  const title = view.kind === "album" ? view.album.title : view.kind === "albums" && view.artist ? view.artist.name : "Music";
  const back = () => view.kind === "album" ? setView({ kind: "albums", offset: view.offset, artist: view.artist, artistOffset: view.artistOffset }) : view.kind === "albums" && view.artist ? setView({ kind: "artists", offset: view.artistOffset ?? 0 }) : onBack();
  const total = view.kind === "artists" ? artists.data?.total ?? 0 : view.kind === "albums" ? albums.data?.total ?? 0 : 0;
  async function queue(title: string, playNow: boolean, work: () => Promise<boolean>) {
    if (busy) return;
    setBusy(true);
    try { if (await work() && !playNow) toast(playNotice(title, "queue")); }
    catch (error) { toast.error(error instanceof Error ? error.message : `Couldn't queue ${title}.`); }
    finally { setBusy(false); }
  }
  return <section className="min-w-0 space-y-6" aria-label="Browse music">
    <PageHeader title={title} back={{ label: view.kind === "album" ? view.artist?.name ?? "Albums" : view.kind === "albums" && view.artist ? "Artists" : "Find", onClick: back }} />
    {(view.kind === "artists" || !view.artist && view.kind === "albums") && <ChoiceGroup label="Music view" value={view.kind} onValueChange={kind => setView({ kind, offset: 0 })} options={[{ value: "artists", label: "Artists" }, { value: "albums", label: "Albums" }]} />}
    {!connected && <p className="text-sm text-muted-foreground" role="status">Reconnect to browse music.</p>}
    {query.isPending && connected && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner />Loading music…</p>}
    {query.error && <Alert variant="destructive"><AlertDescription>Couldn't load music.</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void query.refetch()}>Try again</Button></AlertAction></Alert>}
    {view.kind === "artists" && !!artists.data?.items.length && <MediaList aria-label="Artists">{artists.data.items.map(artist => <MediaRow key={artist.id} title={artist.name} meta={`${artist.albumCount} album${artist.albumCount === 1 ? "" : "s"} · ${artist.trackCount} tracks`}
      art={artist.artworkId ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={artist.artworkId} /> : undefined}
      primary={{ label: "Open", onClick: () => setView({ kind: "albums", artist, offset: 0, artistOffset: view.offset }) }} />)}</MediaList>}
    {view.kind === "albums" && !!albums.data?.items.length && <MediaList aria-label="Albums">{albums.data.items.map(album => <MediaRow key={album.id} title={album.title} meta={[album.artist, `${album.trackCount} tracks`, album.duration != null ? formatDuration(album.duration) : null].filter(Boolean).join(" · ")}
      art={album.artworkId ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={album.artworkId} /> : undefined}
      primary={{ label: "Open", onClick: () => setView({ kind: "album", album, artist: view.artist, offset: view.offset, artistOffset: view.artistOffset }) }} />)}</MediaList>}
    {view.kind === "album" && detail.data && <>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!connected || !canPlay || busy || !detail.data.items.length || detail.data.items.some(item => !item.available)} onClick={() => void queue(view.album.title, true, () => onAlbum(view.album.id, true))}>Play all</Button>
        <Button variant="ghost" disabled={!connected || busy || !detail.data.items.length || detail.data.items.some(item => !item.available)} onClick={() => void queue(view.album.title, false, () => onAlbum(view.album.id, false))}>Queue all</Button>
      </div>
      <MediaList aria-label={`${view.album.title} tracks`}>{detail.data.items.map(item => <MediaRow key={item.id} title={item.title} meta={[item.discNumber != null ? `Disc ${item.discNumber}` : null, item.trackNumber != null ? `Track ${item.trackNumber}` : null, item.artist, !item.available ? "File unavailable" : null].filter(Boolean).join(" · ")}
        art={item.artworkId ? <AuthArtwork origin={credentials.origin} token={credentials.token} id={item.artworkId} /> : undefined}
        primary={{ label: "Play", disabled: !connected || !canPlay || busy || !item.available, onClick: () => void queue(item.title, true, () => onTrack(item.id, true)) }}
        actions={<Button variant="ghost" aria-label={`Queue ${item.title}`} disabled={!connected || busy || !item.available} onClick={() => void queue(item.title, false, () => onTrack(item.id, false))}>Queue</Button>}>
        <DurationBar duration={item.duration} />
      </MediaRow>)}</MediaList>
    </>}
    {!query.isPending && !query.error && !total && view.kind !== "album" && (view.kind === "albums" && view.artist
      ? <Empty className="py-0"><EmptyHeader><EmptyDescription>No albums for this artist. Choose another artist.</EmptyDescription></EmptyHeader></Empty>
      : <Empty className="py-0"><EmptyHeader><EmptyDescription>No tagged music yet. Add a folder of music, then scan it.</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" onClick={() => void navigate({ to: "/settings/sources/folders" })}>Add a folder</Button></EmptyContent></Empty>)}
    {view.kind !== "album" && total > musicPageSize && <nav className="flex items-center gap-3" aria-label="Music pages">
      <Button variant="ghost" disabled={view.offset === 0} onClick={() => setView({ ...view, offset: Math.max(0, view.offset - musicPageSize) })}>Previous</Button>
      <span className="text-sm text-muted-foreground">{view.offset + 1}–{Math.min(view.offset + musicPageSize, total)} of {total}</span>
      <Button variant="ghost" disabled={view.offset + musicPageSize >= total} onClick={() => setView({ ...view, offset: view.offset + musicPageSize })}>Next</Button>
    </nav>}
  </section>;
}
