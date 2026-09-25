import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ListMusic, RefreshCw } from "lucide-react";
import { avoidRadioPlaylistId, type RadioPlaylist } from "../../../../shared/radio";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/api/client";
import type { SourceCredentials } from "@/components/sourceTypes";

type Props = { credentials: SourceCredentials | null; connected: boolean; canManage: boolean };
const empty: SourceCredentials = { origin: "", token: "" };

export function RadioSettings({ credentials, connected, canManage }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const available = connected && canManage && !!credentials;
  const canWrite = available && !busy;
  const page = useQuery({
    queryKey: ["radio", "settings-sources"],
    enabled: available,
    queryFn: () => apiFetch(credentials ?? empty, "/api/radio/sources").then(response => response.json() as Promise<{ sources: RadioPlaylist[] }>),
  });
  const sources = page.data?.sources ?? [];
  const builtIn = sources.find(source => source.id === avoidRadioPlaylistId);

  async function update(path: string, method: string, body?: { name: string; url: string }) {
    if (!credentials || !canWrite) return;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const response = await apiFetch(credentials, `/api/radio/${path}`, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const result = response.status === 204 ? null : await response.json() as { playlist?: RadioPlaylist };
      if (result?.playlist?.error) setError(result.playlist.error);
      else setNotice(method === "DELETE" ? "Source removed. Saved favorites remain available." : `${result?.playlist?.name} updated with ${result?.playlist?.stationCount} stations.`);
      setRemoving(null);
      if (body) { setName(""); setUrl(""); }
      await queryClient.invalidateQueries({ queryKey: ["radio"] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update radio sources.");
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    void update("playlists", "POST", { name: name.trim(), url: url.trim() });
  }

  return (
    <section aria-labelledby="radio-settings-title" className="min-w-0 space-y-4">
      <div><h3 className="text-lg font-medium" id="radio-settings-title">Radio playlists</h3><p className="mt-1 text-sm text-muted-foreground">Stations and favorites belong to the selected playback computer.</p></div>
      {!canManage ? <p className="text-sm text-muted-foreground">An administrator can add, refresh or remove radio sources here. Your stations and favorites remain available in Radio.</p> : <>
        {!connected && <p className="text-sm text-muted-foreground" role="status">Connect to a playback computer to manage radio sources.</p>}
        {page.isFetching && <p className="text-sm text-muted-foreground" role="status">Loading radio sources…</p>}
        {(page.error || error) && (
          <Alert variant="destructive"><AlertDescription className="min-w-0 space-y-2 break-words"><p>{error ?? "Could not load radio sources."}</p><Button className="min-h-11" disabled={!available || busy} onClick={() => void page.refetch()} variant="outline">Reload sources</Button></AlertDescription></Alert>
        )}
        {notice && <p className="text-sm" role="status">{notice}</p>}
        <div className="space-y-3">
          {available && sources.filter(source => source.id !== avoidRadioPlaylistId).map(source => (
            <div className="min-w-0 space-y-3 border-t border-border py-4" data-radio-source-id={source.id} key={source.id}>
              <div className="min-w-0"><h4 className="break-words font-medium">{source.name}</h4><p className="mt-1 break-all text-sm text-muted-foreground">{source.url}</p></div>
              <p className="text-sm text-muted-foreground">{source.stationCount} cached stations · {source.updatedAt ? `Updated ${new Date(source.updatedAt).toLocaleString()}` : "Not imported yet"}</p>
              {source.error && <Alert variant="destructive"><AlertDescription className="space-y-1 break-words"><p>{source.error}</p>{source.updatedAt && <p>The last imported stations are still available.</p>}</AlertDescription></Alert>}
              {removing === source.id ? (
                <div className="space-y-3">
                  <p className="text-sm">Remove this playlist and its imported station catalog? All saved favorites stay available. Queued stations from this source may become unavailable unless saved as favorites. No media files are deleted.</p>
                  <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={!canWrite} onClick={() => void update(`playlists/${encodeURIComponent(source.id)}`, "DELETE")} variant="destructive">Remove source</Button><Button className="min-h-11" disabled={busy} onClick={() => setRemoving(null)} variant="outline">Keep source</Button></div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button className="min-h-11" disabled={!canWrite} onClick={() => void update(`playlists/${encodeURIComponent(source.id)}/refresh`, "POST")} variant="outline"><RefreshCw aria-hidden="true" />Refresh playlist</Button>
                  <Button className="min-h-11" disabled={!canWrite} onClick={() => setRemoving(source.id)} variant="outline">Remove playlist</Button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="min-w-0 space-y-3 border-t border-border py-4">
          <div className="flex items-center gap-3"><ListMusic aria-hidden="true" className="size-6 shrink-0 text-primary" /><div><h4 className="font-medium">avoid radio</h4><p className="text-sm text-muted-foreground">Included with Couch. Available on Home and in Radio.</p></div></div>
          {builtIn?.updatedAt && <p className="text-sm text-muted-foreground">{builtIn.stationCount} stations · Updated {new Date(builtIn.updatedAt).toLocaleString()}</p>}
          {builtIn?.error && <Alert variant="destructive"><AlertDescription>{builtIn.error}</AlertDescription></Alert>}
          <Button className="min-h-11" disabled={!canWrite} onClick={() => void update("avoid?refresh=true", "GET")} variant="outline"><RefreshCw aria-hidden="true" />Refresh avoid radio</Button>
        </div>
        <form className="space-y-3 border-t pt-4" onSubmit={add}>
          <h4 className="font-medium">Add a radio playlist</h4>
          <p className="text-sm text-muted-foreground">Import a supported extended M3U feed. Importing the same URL again refreshes its stations and updates its name.</p>
          <div className="space-y-2"><Label htmlFor="radio-source-name">Playlist name</Label><Input className="min-h-11" disabled={!canWrite} id="radio-source-name" maxLength={200} onChange={event => setName(event.target.value)} placeholder="My radio stations" required value={name} /></div>
          <div className="space-y-2"><Label htmlFor="radio-source-url">M3U playlist URL</Label><Input className="min-h-11" disabled={!canWrite} id="radio-source-url" maxLength={4096} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/playlist.m3u" required type="url" value={url} /></div>
          <Button className="min-h-11" disabled={!canWrite || !name.trim() || !url.trim()}>{busy ? "Updating sources…" : "Import playlist"}</Button>
        </form>
      </>}
    </section>
  );
}
