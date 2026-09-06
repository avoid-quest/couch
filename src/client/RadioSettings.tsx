import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ListMusic, RefreshCw } from "lucide-react";
import type { RadioPlaylist } from "../shared/radio";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const avoidUrl = "https://radio.avoid.quest/playlist.m3u";
type Props = {
  credentials: { origin: string; token: string } | null;
  connected: boolean;
  canManage: boolean;
  version: number;
};

export function RadioSettings({ credentials, connected, canManage, version }: Props) {
  const [sources, setSources] = useState<RadioPlaylist[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  const origin = credentials?.origin;
  const token = credentials?.token;
  const available = connected && canManage && !!credentials;
  const canWrite = available && !busy && !loading;
  const request = useCallback(async (path: string, init: RequestInit) => {
    const response = await fetch(`${origin}/api/radio/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(result?.error || "Could not update radio sources.");
    return result;
  }, [origin, token]);

  useEffect(() => {
    setSources([]);
    setName("");
    setUrl("");
    setError(null);
    setNotice("");
    setRemoving(null);
    setBusy(false);
    return () => mutation.current?.abort();
  }, [origin, token, canManage, connected]);

  useEffect(() => {
    if (!available) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    void request("sources", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) }).then(({ sources }: { sources: RadioPlaylist[] }) => {
      if (!controller.signal.aborted) setSources(sources);
    }).catch(reason => {
      if (!controller.signal.aborted) { setSources([]); setError(reason instanceof Error ? reason.message : "Could not load radio sources."); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [available, request, version, attempt]);

  async function update(path: string, method: string, body?: { name: string; url: string }) {
    if (!canWrite) return;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const result = await request(path, { method, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
      if (controller.signal.aborted) return;
      setNotice(method === "DELETE" ? "Source removed. Saved favorites remain available." : `${result.playlist.name} imported with ${result.playlist.stationCount} stations.`);
      setRemoving(null);
      if (body) { setName(""); setUrl(""); }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not update radio sources.");
    } finally {
      if (!controller.signal.aborted) { setBusy(false); setAttempt(value => value + 1); }
      if (mutation.current === controller) mutation.current = null;
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    void update("playlists", "POST", { name: name.trim(), url: url.trim() });
  }

  return <section className="radio-settings min-w-0 space-y-4" aria-labelledby="radio-settings-title">
    <div><h3 id="radio-settings-title" className="text-lg font-medium">Radio playlists</h3><p className="mt-1 text-sm text-muted-foreground">Imported stations are shared with everyone watching this TV. Browse and play them in Radio.</p></div>
    {!canManage ? <p className="text-sm text-muted-foreground">An administrator can add, refresh or remove radio sources here. Your stations and favorites remain available in Radio.</p> : <>
      {!connected && <p role="status" className="text-sm text-muted-foreground">Connect to the TV to manage radio sources.</p>}
      {loading && <p role="status" className="text-sm text-muted-foreground">Loading radio sources…</p>}
      {error && <Alert variant="destructive"><AlertDescription className="min-w-0 space-y-2 break-words"><p>{error}</p><Button variant="outline" className="min-h-11" disabled={!available || busy} onClick={() => { setError(null); setAttempt(value => value + 1); }}>Reload sources</Button></AlertDescription></Alert>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <div className="space-y-3">{available && sources.map(source => <Card key={source.id} className="radio-source min-w-0 gap-3 p-4" data-radio-source-id={source.id}>
        <div className="min-w-0"><h4 className="break-words font-medium">{source.name}</h4><p className="mt-1 break-all text-sm text-muted-foreground">{source.url}</p></div>
        <p className="text-sm text-muted-foreground">{source.stationCount} cached stations · {source.updatedAt ? `Updated ${new Date(source.updatedAt).toLocaleString()}` : "Not imported yet"}</p>
        {source.error && <Alert variant="destructive"><AlertDescription className="space-y-1 break-words"><p>{source.error}</p>{source.updatedAt && <p>The last imported stations are still available.</p>}</AlertDescription></Alert>}
        {removing === source.id ? <div className="space-y-3">
          <p className="text-sm">Remove this playlist and its imported station catalog? All saved favorites stay available. Queued stations from this source may become unavailable unless saved as favorites. No media files are deleted.</p>
          <div className="flex flex-wrap gap-2"><Button variant="destructive" className="min-h-11" disabled={!canWrite} onClick={() => void update(`playlists/${encodeURIComponent(source.id)}`, "DELETE")}>Remove source</Button><Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setRemoving(null)}>Keep source</Button></div>
        </div> : <div className="flex flex-wrap gap-2"><Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => void update(`playlists/${encodeURIComponent(source.id)}/refresh`, "POST")}><RefreshCw aria-hidden="true" />Refresh playlist</Button><Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => setRemoving(source.id)}>Remove playlist</Button></div>}
      </Card>)}</div>
      {!sources.some(source => source.url === avoidUrl) && <Card className="radio-avoid min-w-0 gap-3 bg-primary/10 p-4 ring-primary/30"><div className="flex items-center gap-3"><ListMusic aria-hidden="true" className="size-6 shrink-0 text-primary" /><div><h4 className="font-medium">avoid radio</h4><p className="text-sm text-muted-foreground">A curated radio collection, ready to add.</p></div></div><Button className="min-h-11" disabled={!canWrite} onClick={() => void update("playlists", "POST", { name: "avoid radio", url: avoidUrl })}>Add avoid radio</Button></Card>}
      <form className="radio-source-add space-y-3 border-t pt-4" onSubmit={add}>
        <h4 className="font-medium">Add a radio playlist</h4>
        <p className="text-sm text-muted-foreground">Import a supported extended M3U feed. Importing the same URL again refreshes its stations and updates its name.</p>
        <div className="space-y-2"><Label htmlFor="radio-source-name">Playlist name</Label><Input id="radio-source-name" className="min-h-11" maxLength={200} required value={name} disabled={!canWrite} onChange={event => setName(event.target.value)} placeholder="My radio stations" /></div>
        <div className="space-y-2"><Label htmlFor="radio-source-url">M3U playlist URL</Label><Input id="radio-source-url" className="min-h-11" type="url" maxLength={4096} required value={url} disabled={!canWrite} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/playlist.m3u" /></div>
        <Button className="min-h-11" disabled={!canWrite || !name.trim() || !url.trim()}>{busy ? "Updating sources…" : "Import playlist"}</Button>
      </form>
    </>}
  </section>;
}
