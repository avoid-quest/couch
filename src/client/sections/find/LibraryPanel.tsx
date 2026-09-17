import { useEffect, useState, type FormEvent } from "react";
import { useInvalidation } from "./useInvalidation";
import type { LibrarySearch, LibrarySource, MusicArtist } from "../../../shared/library";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, Disc3, Film, FolderOpen, MicVocal, Music2, Play, Plus, RotateCcw, Search, Tv, Video } from "lucide-react";
import { ProgressActions, progressTime } from "@/components/HistoryPanel";
import { AuthArtwork } from "@/components/AuthArtwork";
import { MusicPanel } from "@/components/MusicPanel";
import { CollectionsPanel } from "@/components/CollectionsPanel";
import { VideoLibraryPanel } from "@/components/VideoLibraryPanel";

const pageSize = 30;
const statusLabels: Record<LibrarySource["status"], string> = {
  idle: "Not scanned", scanning: "Scanning", ready: "Up to date", unavailable: "Unavailable", error: "Scan failed",
};

function duration(seconds: number | null) {
  if (seconds === null) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function LibraryPanel({ origin, token, host, connected = true, canPlay = true, canManage = false, onEnqueue, onQueueAlbum, onManage }: {
  origin: string;
  token: string;
  host: boolean;
  onManage: () => void;
  connected?: boolean;
  canPlay?: boolean;
  canManage?: boolean;
  onEnqueue: (id: string, options?: { playNow?: boolean; fromStart?: boolean }) => Promise<boolean>;
  onQueueAlbum: (albumId: string, playNow: boolean) => Promise<boolean>;
}) {
  const revision = useInvalidation("library");
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [results, setResults] = useState<LibrarySearch>({ items: [], total: 0, offset: 0, limit: pageSize });
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [enqueuing, setEnqueuing] = useState<{ id: string; playNow: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState("all");
  const [artist, setArtist] = useState<MusicArtist | null>(null);

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const read = async (path: string) => {
      const response = await fetch(`${origin}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load the library.");
      return result;
    };
    void Promise.all([
      read("/api/library/sources"),
      read(`/api/library/items?${new URLSearchParams({ q: query, artistId: artist?.id ?? "", offset: String(offset), limit: String(pageSize) })}`),
    ]).then(([folders, items]: [{ sources: LibrarySource[] }, LibrarySearch]) => {
      if (controller.signal.aborted) return;
      setSources(folders.sources);
      setResults(items);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the library.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [origin, token, connected, query, artist?.id, offset, refresh, revision]);

  const search = (event: FormEvent) => { event.preventDefault(); setOffset(0); setQuery(draft.trim()); setRefresh(value => value + 1); };
  const enqueue = async (id: string, title: string, options?: { playNow?: boolean; fromStart?: boolean }) => {
    setEnqueuing({ id, playNow: !!options?.playNow });
    setNotice(null);
    setError(null);
    try { if (await onEnqueue(id, options)) setNotice(options?.playNow ? `Starting ${title} on the TV.` : `Added ${title} to the queue.`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not queue this item."); }
    finally { setEnqueuing(null); }
  };

  return <section className="min-w-0 space-y-5" aria-label="Media library">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h2 className="text-2xl font-semibold">TV folders</h2><p className="mt-1 text-sm text-muted-foreground">Media stored on this TV.</p></div>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button variant="outline" data-action="folder-settings" data-tv-local-only={host || undefined} onClick={onManage}>Manage folders in Sources</Button>
        {sources.length > 0 && <Dialog open={foldersOpen} onOpenChange={setFoldersOpen}>
      <DialogTrigger asChild><Button variant="outline" data-action="library-folders" data-tv-local-only={host || undefined} aria-label={`${sources.length} library folder${sources.length === 1 ? "" : "s"}`}><FolderOpen aria-hidden="true" />Folders<Badge variant="secondary">{sources.length}</Badge>{sources.some(source => source.status === "scanning") && <span className="inline-block size-[7px] rounded-full bg-primary" aria-label="Scanning" />}</Button></DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl" data-tv-local-only={host || undefined}>
        <DialogHeader><DialogTitle>Library folders</DialogTitle><DialogDescription>{"An administrator manages TV folders in Settings > Sources."}</DialogDescription></DialogHeader>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <ul className="space-y-3">{sources.map(source => <li key={source.id}>
          <Card className="gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong className="break-words text-base">{source.name}</strong><Badge variant={source.status === "error" || source.status === "unavailable" ? "destructive" : "secondary"}>{statusLabels[source.status]}</Badge></div>
            <p className="text-sm text-muted-foreground">{source.itemCount} items</p>
            {host && source.path && <p className="break-all text-sm text-muted-foreground">{source.path}</p>}
            {source.error && <Alert variant="destructive"><AlertDescription>{source.error}</AlertDescription></Alert>}
            {source.warning && <p className="text-sm text-muted-foreground">{source.warning.replace(" Media is still playable.", "")}</p>}

          </Card>
        </li>)}</ul>
        <Button variant="outline" data-tv-local-only={host || undefined} onClick={() => { setFoldersOpen(false); onManage(); }}>Manage folders in Sources</Button>
      </DialogContent>
    </Dialog>}
      </div>
    </div>
    {error && <Alert variant="destructive" ><AlertDescription className="space-y-3"><p>{error}</p><Button variant="outline" disabled={!connected || loading} onClick={() => setRefresh(value => value + 1)}>Try again</Button></AlertDescription></Alert>}
    <Tabs value={view} onValueChange={setView} className="gap-4">
      <TabsList aria-label="Library view" className="grid h-auto w-full grid-cols-3 gap-1 md:grid-cols-6"><TabsTrigger value="all"><FolderOpen aria-hidden="true" />All media</TabsTrigger><TabsTrigger value="movies"><Film aria-hidden="true" />Movies</TabsTrigger><TabsTrigger value="shows"><Tv aria-hidden="true" />Shows</TabsTrigger><TabsTrigger value="artists"><MicVocal aria-hidden="true" />Artists</TabsTrigger><TabsTrigger value="albums"><Disc3 aria-hidden="true" />Albums</TabsTrigger><TabsTrigger value="collections">Collections</TabsTrigger></TabsList>
      {(["movies", "shows"] as const).map(videoView => <TabsContent key={videoView} value={videoView} forceMount hidden={view !== videoView}><VideoLibraryPanel canManage={canManage} origin={origin} token={token} connected={connected} canPlay={canPlay} version={0} view={videoView} active={view === videoView} onEnqueue={onEnqueue} /></TabsContent>)}
      {(["artists", "albums"] as const).map(musicView => <TabsContent key={musicView} value={musicView} forceMount hidden={view !== musicView}><MusicPanel origin={origin} token={token} connected={connected} canPlay={canPlay} view={musicView} active={view === musicView} onEnqueue={onEnqueue} onQueueAlbum={onQueueAlbum} onArtistTracks={selected => { setArtist(selected); setDraft(""); setQuery(""); setOffset(0); setView("all"); requestAnimationFrame(() => document.querySelector<HTMLInputElement>("#library-query")?.focus()); }} /></TabsContent>)}
      <TabsContent value="collections" forceMount hidden={view !== "collections"}><CollectionsPanel origin={origin} token={token} connected={connected} canPlay={canPlay} version={0} active={view === "collections"} /></TabsContent>
      <TabsContent value="all" className="space-y-4">
    {artist && <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3"><p className="min-w-0 flex-1 break-words text-sm">Tracks by <strong>{artist.name}</strong>, including singles</p><Button variant="outline" onClick={() => { setArtist(null); setOffset(0); requestAnimationFrame(() => document.querySelector<HTMLInputElement>("#library-query")?.focus()); }}>Show all artists</Button></div>}
    <form className="flex w-full items-end gap-2" role="search" onSubmit={search}>
      <div className="min-w-0 flex-1"><Label htmlFor="library-query" className="sr-only">Search library</Label><Input id="library-query" aria-label="Search library" type="search" placeholder="Search title, artist or album" maxLength={200} value={draft} disabled={!connected} onChange={event => setDraft(event.target.value)} /></div>
      <Button className="primary-button" variant="secondary" size="icon" type="submit" aria-label="Search" disabled={!connected || loading}><Search aria-hidden="true" /></Button>
    </form>
    <div className="text-sm text-muted-foreground" aria-live="polite">{loading ? "Loading library…" : `${results.total} item${results.total === 1 ? "" : "s"}`}</div>
    {notice && <p className="text-sm text-primary" role="status">{notice}</p>}
    {!connected && <p className="text-sm text-muted-foreground" role="status">Reconnect to browse and play your library.</p>}
    {!loading && !error && results.items.length === 0 && <Card className="p-5 text-sm leading-relaxed text-muted-foreground">{query ? "No matching media. Try another title or artist." : sources.length ? "No media found yet. Scans include supported audio and video files." : "An administrator can add TV folders in Settings > Sources to start your collection."}</Card>}
    <ul className="space-y-2 aria-busy:opacity-70" aria-busy={loading}>{results.items.map(item => <li key={item.id}>
      <Card className="gap-3 p-3">
        <div className="flex min-w-0 items-center gap-3">
          {item.artworkId ? <AuthArtwork origin={origin} token={token} id={item.artworkId} video={item.kind === "video"} className={`library-kind ${item.kind} size-11`} /> : <span className={`library-kind ${item.kind} grid size-11 shrink-0 place-items-center rounded-lg bg-muted text-primary`} aria-label={item.kind}>{item.kind === "audio" ? <Music2 aria-hidden="true" className="size-5" /> : <Video aria-hidden="true" className="size-5" />}</span>}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><strong className="break-words text-base font-medium">{item.title}</strong>{item.progress?.watched && <Badge variant="secondary"><Check aria-hidden="true" />Watched</Badge>}</div>
            <span className="mt-1 block break-words text-sm leading-relaxed text-muted-foreground">{[item.artist, item.album, duration(item.duration)].filter(Boolean).join(" · ") || (item.kind === "audio" ? "Audio" : "Video")}{!item.available && " · File unavailable"}</span>
            {!!item.progress?.position && <span className="mt-1 block text-xs text-primary">Continue from {progressTime(item.progress.position)}</span>}
          </div>
          <ProgressActions origin={origin} token={token} connected={connected} mediaId={`library:${item.id}`} title={item.title} progress={item.progress} onUpdated={() => setRefresh(value => value + 1)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" aria-label={`${item.progress?.position ? "Resume" : "Play"} ${item.title}`} disabled={!connected || !canPlay || !item.available || loading || enqueuing !== null} onClick={() => void enqueue(item.id, item.title, { playNow: true })}><Play aria-hidden="true" />{enqueuing?.id === item.id && enqueuing.playNow ? "Starting…" : item.progress?.position ? "Resume" : "Play"}</Button>
          {!!item.progress?.position && <Button variant="outline" className="min-h-11" aria-label={`Play ${item.title} from start`} disabled={!connected || !canPlay || !item.available || loading || enqueuing !== null} onClick={() => void enqueue(item.id, item.title, { playNow: true, fromStart: true })}><RotateCcw aria-hidden="true" />From start</Button>}
          <Button variant="secondary" className="min-h-11" aria-label={`Add ${item.title} to queue`} disabled={!connected || !item.available || loading || enqueuing !== null} onClick={() => void enqueue(item.id, item.title)}><Plus aria-hidden="true" />{enqueuing?.id === item.id && !enqueuing.playNow ? "Adding…" : "Queue"}</Button>
        </div>
      </Card>
    </li>)}</ul>
    {results.total > pageSize && <nav className="flex items-center justify-between gap-2" aria-label="Library pages">
      <Button variant="outline" disabled={!connected || offset === 0 || loading} onClick={() => setOffset(value => Math.max(0, value - pageSize))}>Previous</Button>
      <span className="text-center text-sm text-muted-foreground">{offset + 1}–{Math.min(offset + pageSize, results.total)} of {results.total}</span>
      <Button variant="outline" disabled={!connected || offset + pageSize >= results.total || loading} onClick={() => setOffset(value => value + pageSize)}>Next</Button>
    </nav>}
      </TabsContent>
    </Tabs>
  </section>;
}
