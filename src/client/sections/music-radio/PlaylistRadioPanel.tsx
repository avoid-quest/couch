import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { avoidRadioPlaylistId, type RadioStation } from "../../../shared/radio";
import type { Credentials } from "../../session/session";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioStationList } from "./RadioStationList";
import { radioPlaylistStationsQuery, radioPlaylistsQuery } from "@/api/radio";

type Props = {
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  host: boolean;
  onManage: () => void;
  favorites: RadioStation[];
  busyId: string | null;
  onPlay: (station: RadioStation) => void;
  onQueue: (station: RadioStation) => void;
  onFavorite: (station: RadioStation, saved: boolean) => void;
};

export function PlaylistRadioPanel({ credentials, connected, canPlay, host, onManage, favorites, busyId, onPlay, onQueue, onFavorite }: Props) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const playlists = useQuery({ ...radioPlaylistsQuery(credentials), enabled: connected });
  const custom = (playlists.data?.playlists ?? []).filter(playlist => playlist.id !== avoidRadioPlaylistId);
  const [selectedId, setSelectedId] = useState("");
  const selectedIdOrFirst = selectedId && custom.some(playlist => playlist.id === selectedId) ? selectedId : custom[0]?.id ?? "";
  const stations = useQuery({ ...radioPlaylistStationsQuery(credentials, selectedIdOrFirst, query), enabled: connected && !!selectedIdOrFirst });
  const selected = custom.find(playlist => playlist.id === selectedIdOrFirst);
  const error = playlists.error?.message ?? stations.error?.message ?? null;

  const search = (event: FormEvent) => {
    event.preventDefault();
    setQuery(draft.trim());
  };

  return <section className="space-y-4" aria-labelledby="radio-playlists-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 id="radio-playlists-title" className="flex items-center gap-2 text-lg font-medium">Your playlists <Badge variant="secondary">{custom.length}</Badge></h3>
      <Button variant="outline" className="min-h-11" data-action="radio-settings" data-tv-local-only={host ? "" : undefined} disabled={!connected} onClick={onManage}>Manage radio sources</Button>
    </div>
    {!custom.length && !playlists.isFetching && <p className="text-sm text-muted-foreground">Custom radio playlists are optional.</p>}
    {error && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><p className="break-words">{error}</p>{stations.error && <Button variant="outline" disabled={!connected} onClick={() => void stations.refetch()}>Try again</Button>}</AlertDescription></Alert>}
    {custom.length > 0 && <div className="space-y-3">
      <Label className="sr-only" htmlFor="radio-playlist-select">Playlist</Label>
      <Select value={selectedIdOrFirst} disabled={!connected} onValueChange={setSelectedId}>
        <SelectTrigger id="radio-playlist-select" className="w-full min-w-0"><SelectValue placeholder="Choose a playlist" /></SelectTrigger>
        <SelectContent position="popper" className="max-w-[calc(100vw-2rem)]">{custom.map(playlist => <SelectItem key={playlist.id} value={playlist.id}>{playlist.name} · {playlist.stationCount} stations</SelectItem>)}</SelectContent>
      </Select>
      {selected && <>
        {selected.error && <Alert variant="destructive"><AlertDescription>{selected.error}</AlertDescription></Alert>}
        <form className="flex items-end gap-2" role="search" onSubmit={search}><div className="min-w-0 flex-1"><Label className="sr-only" htmlFor="radio-playlist-query">Search this playlist</Label><Input id="radio-playlist-query" type="search" maxLength={100} value={draft} disabled={!connected} onChange={event => setDraft(event.target.value)} placeholder="Search stations or groups" /></div><Button variant="secondary" disabled={!connected || stations.isFetching}>Search</Button></form>
        {stations.isFetching && <p className="text-sm text-muted-foreground" role="status">Loading stations…</p>}
        {!stations.isFetching && !stations.data?.stations.length && <p className="text-sm text-muted-foreground">{query ? "No stations match this search." : "No radio stations in this playlist."}</p>}
        {stations.data?.stations && <RadioStationList stations={stations.data.stations} favorites={favorites} connected={connected} canPlay={canPlay} busyId={busyId} onPlay={onPlay} onQueue={onQueue} onFavorite={onFavorite} />}
        <p className="text-xs text-muted-foreground">{selected.updatedAt ? `Updated ${new Date(selected.updatedAt).toLocaleString()}` : "Not updated yet"}</p>
      </>}
    </div>}
  </section>;
}
