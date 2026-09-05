import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { RadioPlaylistSummary, RadioStation } from "../shared/radio";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


type Props = {
  connected: boolean;
  host?: boolean;
  onManage?: () => void;
  version: number;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  renderStations: (stations: RadioStation[]) => ReactNode;
};

export function PlaylistRadioPanel({ connected, version, request, renderStations, onManage, host }: Props) {
  const [playlists, setPlaylists] = useState<RadioPlaylistSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const selected = playlists.find(playlist => playlist.id === selectedId);

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    void request("playlists", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) })
      .then(response => response.json() as Promise<{ playlists: RadioPlaylistSummary[] }>)
      .then(body => {
        if (controller.signal.aborted) return;
        setPlaylists(body.playlists);
        setSelectedId(current => body.playlists.some(playlist => playlist.id === current) ? current : body.playlists[0]?.id ?? "");
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
    setSelectedId(id);
    setStations([]);
    setDraft("");
    setQuery("");
    setError(null);
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
      <Button variant="outline" className="min-h-11" data-action="radio-settings" data-tv-local-only={host ? "" : undefined} disabled={!connected || !onManage} onClick={onManage}>Manage radio sources</Button>
    </div>
    {!playlists.length && <p className="text-sm text-muted-foreground">An administrator can add a radio playlist in Settings &gt; Sources.</p>}
    {error && <Alert variant="destructive" className="radio-playlist-error"><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><p className="break-words">{error}</p><Button variant="outline" disabled={!connected} onClick={() => { setError(null); setAttempt(value => value + 1); }}>Try again</Button></AlertDescription></Alert>}
    {playlists.length > 0 && <div className="radio-playlist-selection space-y-3">
      <div className="radio-playlist-toolbar">
      <div className="radio-playlist-picker min-w-0"><Label className="sr-only" htmlFor="radio-playlist-select">Playlist</Label>
        <Select value={selectedId} disabled={!connected} onValueChange={choose}>
          <SelectTrigger id="radio-playlist-select" className="w-full min-w-0"><SelectValue placeholder="Choose a playlist" /></SelectTrigger>
          <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">{playlists.map(playlist => <SelectItem key={playlist.id} value={playlist.id}>{playlist.name} · {playlist.stationCount} stations</SelectItem>)}</SelectContent>
        </Select>
      </div>

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
