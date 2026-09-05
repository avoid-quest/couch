import { useEffect, useRef, useState, type FormEvent } from "react";
import type { JellyfinItems, JellyfinStatus } from "../shared/jellyfin";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Music2, Play, Plus, RotateCcw, Settings2, Tv, Video } from "lucide-react";

type Props = {
  origin: string;
  token: string;
  host: boolean;
  connected: boolean;
  canPlay?: boolean;
  version: number;
  onEnqueue: (itemId: string, options?: { playNow?: boolean; fromStart?: boolean }) => Promise<boolean>;
};

const message = (error: unknown) => error instanceof Error ? error.message : "The Jellyfin request failed.";
const duration = (seconds: number | null) => seconds === null ? "" : seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m` : `${Math.max(1, Math.floor(seconds / 60))}m`;
const position = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function JellyfinPanel({ origin, token, host, connected, canPlay = true, version, onEnqueue }: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState<JellyfinStatus | null>(null);
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ query: "", startIndex: 0, attempt: 0, resume: false });
  const [page, setPage] = useState<JellyfinItems | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<{ id: string; playNow: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const operation = useRef<AbortController | null>(null);

  async function request<T>(path = "", init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${origin}/api/jellyfin${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: init.signal ?? AbortSignal.timeout(25_000),
    });
    const body = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(body.error || "Could not reach Jellyfin.");
    return body;
  }

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    void request<JellyfinStatus>("", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) })
      .then(next => { if (!controller.signal.aborted) setStatus(next); })
      .catch(reason => { if (!controller.signal.aborted) setError(message(reason)); });
    return () => controller.abort();
  }, [origin, token, connected, version]);

  useEffect(() => {
    if (!connected || !status?.connected) { setPage(null); return; }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ q: search.query, startIndex: String(search.startIndex), resume: String(search.resume) });
    void request<JellyfinItems>(`/items?${params}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(next => { if (!controller.signal.aborted) setPage(next); })
      .catch(reason => { if (!controller.signal.aborted) { setPage(null); setError(message(reason)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [origin, token, connected, version, status?.connected, status?.serverName, status?.username, search]);

  useEffect(() => () => operation.current?.abort(), []);

  async function connect(event: FormEvent) {
    event.preventDefault();
    const controller = new AbortController();
    operation.current?.abort();
    operation.current = controller;
    setBusy(true);
    setError(null);
    try {
      const next = await request<JellyfinStatus>("", { method: "POST", body: JSON.stringify({ url: url.trim(), username: username.trim(), password }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) });
      if (!controller.signal.aborted) { setStatus(next); setSearch({ query: "", startIndex: 0, attempt: 0, resume: false }); setNotice("Jellyfin connected."); setSettingsOpen(false); }
    } catch (reason) {
      if (!controller.signal.aborted) setError(message(reason));
    } finally {
      setPassword("");
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await request("", { method: "DELETE" });
      setStatus({ connected: false, serverName: null, username: null });
      setPage(null);
      setNotice("Jellyfin disconnected.");
      setSettingsOpen(false);
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }

  async function enqueue(id: string, title: string, options?: { playNow?: boolean; fromStart?: boolean }) {
    setAdding({ id, playNow: options?.playNow === true });
    setNotice("");
    try { if (await onEnqueue(id, options)) setNotice(options?.playNow ? `Starting ${title} on the TV.` : `Added ${title} to the queue.`); }
    catch (reason) { setError(message(reason)); }
    finally { setAdding(null); }
  }

  return <section className="jellyfin-panel catalog-panel min-w-0 space-y-5" aria-label="Jellyfin library">
    <div className="jellyfin-heading catalog-heading flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="break-words text-2xl font-semibold">{status?.serverName || "Jellyfin"}</h2>{status?.connected && <p className="mt-1 text-sm text-muted-foreground">Watching as <strong className="font-medium text-foreground">{status.username || "the connected Jellyfin account"}</strong></p>}</div>
      {host && <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogTrigger asChild><Button variant="outline" data-action="jellyfin-settings" data-tv-local-only disabled={!connected || status === null}><Settings2 aria-hidden="true" />{status?.connected ? "Server settings" : "Connect Jellyfin"}</Button></DialogTrigger>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg" data-tv-local-only>
          <DialogHeader><DialogTitle>{status?.connected ? "Jellyfin connection" : "Connect Jellyfin"}</DialogTitle><DialogDescription>{status?.connected ? `Watching history belongs to ${status.username || "the connected Jellyfin account"}. Every paired controller uses this account.` : "Connect once on the TV. Every paired controller can then browse your movies, episodes and music."}</DialogDescription></DialogHeader>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {status?.connected ? <div className="space-y-4">
            <Card className="gap-2 p-4"><strong className="break-words text-base">{status.serverName || "Jellyfin"}</strong><Badge variant="secondary" className="self-start">Connected</Badge></Card>
            <p className="text-sm leading-relaxed text-muted-foreground">Disconnecting removes the saved server token and stops any Jellyfin item playing on the TV.</p>
            <Button variant="destructive" data-action="jellyfin-disconnect" disabled={!connected || busy} onClick={() => void disconnect()}>{busy ? "Disconnecting…" : "Disconnect"}</Button>
          </div> : <form onSubmit={connect} className="jellyfin-connect space-y-4">
            <div className="space-y-2"><Label htmlFor="jellyfin-url">Jellyfin server URL</Label><Input id="jellyfin-url" type="url" placeholder="http://192.168.1.10:8096" value={url} onChange={event => setUrl(event.target.value)} required disabled={busy || !connected} autoComplete="url" /></div>
            <div className="space-y-2"><Label htmlFor="jellyfin-user">Username</Label><Input id="jellyfin-user" value={username} onChange={event => setUsername(event.target.value)} required disabled={busy || !connected} autoComplete="username" /></div>
            <div className="space-y-2"><Label htmlFor="jellyfin-password">Password</Label><Input id="jellyfin-password" type="password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy || !connected} autoComplete="current-password" /></div>
            <Button className="primary-button" disabled={busy || !connected}>{busy ? "Connecting…" : "Connect Jellyfin"}</Button>
            <p className="text-sm leading-relaxed text-muted-foreground">The TV stores an access token. Your password is not saved.</p>
          </form>}
        </DialogContent>
      </Dialog>}
    </div>
    {error && !settingsOpen && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <p className="jellyfin-notice text-sm text-primary" role="status">{notice}</p>}
    {status === null ? <p className="text-sm text-muted-foreground" role="status">{connected ? "Checking Jellyfin connection…" : "Connect to the player to use Jellyfin."}</p> : !status.connected ? <Card className="p-5 text-sm leading-relaxed text-muted-foreground">{host ? "Connect your Jellyfin server to browse movies, episodes and music on every paired screen." : "Connect Jellyfin on the TV to browse movies, episodes and music here."}</Card> : <>
      <Tabs value={search.resume ? "resume" : "all"} onValueChange={value => setSearch({ ...search, resume: value === "resume", startIndex: 0 })}>
        <TabsList aria-label="Jellyfin library view" className="w-full"><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="resume">Continue watching</TabsTrigger></TabsList>
        <TabsContent value={search.resume ? "resume" : "all"} className="mt-3 space-y-5">
      <form className="jellyfin-search space-y-2" role="search" onSubmit={event => { event.preventDefault(); setSearch({ ...search, query: query.trim(), startIndex: 0, attempt: search.attempt + 1 }); }}>
        <Label htmlFor="jellyfin-query">Search movies, episodes and music</Label>
        <div className="flex gap-2"><Input id="jellyfin-query" className="min-w-0" type="search" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="Title or artist" disabled={!connected} /><Button variant="secondary" className="secondary-button" disabled={!connected || loading}>Search</Button></div>
      </form>
      {loading && <p className="text-sm text-muted-foreground" role="status">Loading library…</p>}
      {!loading && page?.items.length === 0 && <Card className="p-5 text-sm text-muted-foreground">{search.query ? "No matching items. Try another search." : search.resume ? "No unfinished movies, episodes or music for this Jellyfin account." : "No movies, episodes or music found in this library."}</Card>}
      {!!page?.items.length && <ul className="jellyfin-items space-y-3" aria-busy={loading}>{page.items.map(item => <li key={item.id}>
        <Card className="catalog-row gap-3 p-3">
          <div className="catalog-row-main flex min-w-0 items-center gap-3">
          <span className={`jellyfin-kind jellyfin-kind-${item.kind.toLowerCase()} grid size-11 shrink-0 place-items-center rounded-lg bg-muted text-primary`} aria-hidden="true">{item.kind === "Audio" ? <Music2 className="size-5" /> : item.kind === "Episode" ? <Tv className="size-5" /> : <Video className="size-5" />}</span>
          <div className="jellyfin-item-copy min-w-0 flex-1"><h3 className="break-words text-base font-medium">{item.title}</h3><p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">{[item.detail, item.kind, duration(item.duration)].filter(Boolean).join(" · ")}</p>{(item.played || item.resumePosition > 0) && <Badge variant="secondary" className="mt-2">{item.resumePosition > 0 ? `Resume at ${position(item.resumePosition)}` : "Played"}</Badge>}</div>
          </div>
          <div className="catalog-row-actions flex flex-wrap gap-2">
            <Button aria-label={`${item.resumePosition > 0 ? "Resume" : "Play"} ${item.title} on TV`} disabled={!connected || !canPlay || adding !== null || loading} onClick={() => void enqueue(item.id, item.title, { playNow: true })}><Play aria-hidden="true" />{adding?.id === item.id && adding.playNow ? "Starting…" : item.resumePosition > 0 ? "Resume" : "Play"}</Button>
            <Button variant="secondary" className="secondary-button" aria-label={`Add ${item.title} to queue`} disabled={!connected || adding !== null || loading} onClick={() => void enqueue(item.id, item.title)}><Plus aria-hidden="true" />{adding?.id === item.id && !adding.playNow ? "Adding…" : "Queue"}</Button>
            {item.resumePosition > 0 && <Button variant="outline" aria-label={`Play ${item.title} from start`} disabled={!connected || !canPlay || adding !== null || loading} onClick={() => void enqueue(item.id, item.title, { playNow: true, fromStart: true })}><RotateCcw aria-hidden="true" />From start</Button>}
          </div>
        </Card>
      </li>)}</ul>}
      {page && page.total > 50 && <nav className="jellyfin-pagination flex items-center justify-between gap-2" aria-label="Jellyfin pages"><Button variant="outline" disabled={!connected || loading || search.startIndex === 0} onClick={() => setSearch({ ...search, startIndex: Math.max(0, search.startIndex - 50) })}>Previous</Button><span className="text-center text-sm text-muted-foreground">{search.startIndex + 1}–{Math.min(search.startIndex + 50, page.total)} of {page.total}</span><Button variant="outline" disabled={!connected || loading || search.startIndex + 50 >= page.total} onClick={() => setSearch({ ...search, startIndex: search.startIndex + 50 })}>Next</Button></nav>}
        </TabsContent>
      </Tabs>
    </>}
  </section>;
}
