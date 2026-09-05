import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { RadioPlaylist, RadioStation } from "../shared/radio";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListMusic, Plus, RefreshCw } from "lucide-react";

const avoidUrl = "https://radio.avoid.quest/playlist.m3u";

type Props = {
  connected: boolean;
  version: number;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  renderStations: (stations: RadioStation[]) => ReactNode;
};

export function PlaylistRadioPanel({ connected, version, request, renderStations }: Props) {
  const [importOpen, setImportOpen] = useState(false);
  const [playlists, setPlaylists] = useState<RadioPlaylist[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"import" | "refresh" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const preferredSelection = useRef<string | null>(null);
  const selected = playlists.find(playlist => playlist.id === selectedId);

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    void request("playlists", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) })
      .then(response => response.json() as Promise<{ playlists: RadioPlaylist[] }>)
      .then(body => {
        if (controller.signal.aborted) return;
        const preferred = preferredSelection.current;
        preferredSelection.current = null;
        setPlaylists(body.playlists);
        setSelectedId(current => body.playlists.some(playlist => playlist.id === preferred) ? preferred! : body.playlists.some(playlist => playlist.id === current) ? current : body.playlists[0]?.id ?? "");
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load playlists."); });
    return () => controller.abort();
  }, [connected, version, request, attempt]);

  useEffect(() => {
    setStations([]);
    setDraft("");
    setQuery("");
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) { setStations([]); setLoading(false); setError(null); return; }
    if (!connected) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    void request(`playlists/${encodeURIComponent(selectedId)}/stations?${new URLSearchParams({ q: query })}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) })
      .then(response => response.json() as Promise<{ stations: RadioStation[] }>)
      .then(body => { if (!controller.signal.aborted) { setStations(body.stations); setError(null); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load stations."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [connected, selectedId, query, version, request, attempt]);

  function choose(id: string) {
    preferredSelection.current = null;
    setSelectedId(id);
    setStations([]);
    setDraft("");
    setQuery("");
    setError(null);
    setNotice("");
  }

  async function add(playlistName: string, playlistUrl: string) {
    setBusy("import");
    setError(null);
    setNotice("");
    try {
      const response = await request("playlists", { method: "POST", body: JSON.stringify({ name: playlistName.trim(), url: playlistUrl.trim() }) });
      const { playlist } = await response.json() as { playlist: RadioPlaylist };
      preferredSelection.current = playlist.id;
      setAttempt(value => value + 1);
      setName("");
      setUrl("");
      setImportOpen(false);
      setNotice(`${playlist.name} added with ${playlist.stationCount} stations.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import this playlist."); }
    finally { setBusy(null); }
  }

  async function update(remove: boolean) {
    if (!selected) return;
    setBusy(remove ? "remove" : "refresh");
    setError(null);
    setNotice("");
    try {
      const path = `playlists/${encodeURIComponent(selected.id)}`;
      const response = await request(remove ? path : `${path}/refresh`, { method: remove ? "DELETE" : "POST" });
      if (remove) {
        setNotice(`${selected.name} removed.`);
      } else {
        const { playlist } = await response.json() as { playlist: RadioPlaylist };
        setNotice(playlist.error ? "The playlist could not refresh. Saved stations are still available." : `${playlist.name} refreshed.`);
      }
      setAttempt(value => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update this playlist."); }
    finally { setBusy(null); }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    setQuery(draft.trim());
    setAttempt(value => value + 1);
    setError(null);
  }

  return <section className="radio-playlists space-y-4" aria-labelledby="radio-playlists-title">
    <div className="radio-playlist-heading flex flex-wrap items-center justify-between gap-3">
      <h3 id="radio-playlists-title" className="flex items-center gap-2 text-lg font-medium">Your playlists <Badge variant="secondary">{playlists.length}</Badge></h3>
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogTrigger asChild><Button variant="outline" data-action="add-radio-playlist" aria-label="Add a playlist" disabled={!connected || busy !== null}><Plus aria-hidden="true" />Add playlist</Button></DialogTrigger>
        <DialogContent className="radio-playlist-add max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>Add a radio playlist</DialogTitle><DialogDescription>Import a Kodi-compatible M3U feed. Its stations and favorites are shared with every controller.</DialogDescription></DialogHeader>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <form className="space-y-4" onSubmit={event => { event.preventDefault(); void add(name, url); }}>
            <div className="space-y-2"><Label htmlFor="radio-playlist-name">Playlist name</Label><Input id="radio-playlist-name" maxLength={100} required value={name} disabled={!connected || busy !== null} onChange={event => setName(event.target.value)} placeholder="My radio stations" /></div>
            <div className="space-y-2"><Label htmlFor="radio-playlist-url">M3U playlist URL</Label><Input id="radio-playlist-url" type="url" maxLength={4096} required value={url} disabled={!connected || busy !== null} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/playlist.m3u" /></div>
            <Button className="secondary-button" disabled={!connected || busy !== null || !name.trim() || !url.trim()}>{busy === "import" ? "Importing…" : "Import playlist"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
    {!playlists.some(playlist => playlist.url === avoidUrl) && <Card className="radio-avoid flex-row flex-wrap items-center gap-4 bg-primary/10 p-4 ring-primary/30"><ListMusic aria-hidden="true" className="size-7 shrink-0 text-primary" /><div className="flex-[1_1_140px]"><strong className="text-lg font-medium">avoid radio</strong><p className="mt-1 text-sm leading-relaxed text-muted-foreground">A curated radio collection, ready to add.</p></div><Button className="primary-button" disabled={!connected || busy !== null} onClick={() => void add("avoid radio", avoidUrl)}>{busy === "import" ? "Adding…" : "Add avoid radio"}</Button></Card>}
    {error && !importOpen && <Alert variant="destructive" className="radio-playlist-error"><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><p className="break-words">{error}</p><Button variant="outline" disabled={!connected || busy !== null} onClick={() => { setError(null); setAttempt(value => value + 1); }}>Try again</Button></AlertDescription></Alert>}
    {notice && <p className="radio-notice text-sm text-primary" role="status">{notice}</p>}
    {playlists.length > 0 && <div className="radio-playlist-selection space-y-3">
      <div className="radio-playlist-toolbar">
      <div className="radio-playlist-picker min-w-0"><Label className="sr-only" htmlFor="radio-playlist-select">Playlist</Label>
        <Select value={selectedId} disabled={!connected || busy !== null} onValueChange={choose}>
          <SelectTrigger id="radio-playlist-select" className="w-full min-w-0"><SelectValue placeholder="Choose a playlist" /></SelectTrigger>
          <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">{playlists.map(playlist => <SelectItem key={playlist.id} value={playlist.id}>{playlist.name} · {playlist.stationCount} stations</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {selected && <div className="radio-playlist-tools flex items-center gap-1"><Button variant="ghost" size="icon" aria-label={busy === "refresh" ? "Refreshing…" : "Refresh"} title="Refresh playlist" disabled={!connected || busy !== null} onClick={() => void update(false)}><RefreshCw aria-hidden="true" className={busy === "refresh" ? "animate-spin" : ""} /></Button><Button variant="ghost" disabled={!connected || busy !== null} onClick={() => void update(true)}>{busy === "remove" ? "Removing…" : "Remove"}</Button></div>}
      </div>
      {selected && <>
        {selected.error && <Alert variant="destructive" className="radio-error"><AlertDescription>{selected.error}</AlertDescription></Alert>}
        <form className="radio-playlist-search catalog-search flex items-end gap-2" role="search" onSubmit={search}><div className="min-w-0 flex-1"><Label className="sr-only" htmlFor="radio-playlist-query">Search this playlist</Label><Input id="radio-playlist-query" type="search" maxLength={100} value={draft} disabled={!connected} onChange={event => setDraft(event.target.value)} placeholder="Search stations or groups" /></div><Button variant="secondary" className="secondary-button" disabled={!connected || loading}>Search</Button></form>
        {loading && <p className="radio-empty text-sm text-muted-foreground" role="status">Loading stations…</p>}
        {!loading && !stations.length && <p className="radio-empty text-sm text-muted-foreground">{query ? "No stations match this search." : "No radio stations in this playlist."}</p>}
        {renderStations(stations)}
        <p className="text-xs text-muted-foreground">{selected.updatedAt ? `Updated ${new Date(selected.updatedAt).toLocaleString()}` : "Not updated yet"}</p>
      </>}
    </div>}
  </section>;
}
