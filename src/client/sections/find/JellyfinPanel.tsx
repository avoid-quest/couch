import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { JellyfinItems, JellyfinStatus } from "../../../shared/jellyfin";
import { apiFetch } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  onManage: () => void;
  onEnqueue: (itemId: string, options?: { playNow?: boolean; fromStart?: boolean }) => Promise<boolean>;
};

const message = (error: unknown) => error instanceof Error ? error.message : "The Jellyfin request failed.";
const duration = (seconds: number | null) => seconds === null ? "" : seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m` : `${Math.max(1, Math.floor(seconds / 60))}m`;
const position = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function JellyfinPanel({ origin, token, host, connected, canPlay = true, onManage, onEnqueue }: Props) {
  const client = useQueryClient();
  const credentials = { origin, token };
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ query: "", startIndex: 0, resume: false });
  const statusQuery = useQuery({
    queryKey: ["jellyfin", "status"], enabled: connected, retry: false,
    queryFn: ({ signal }) => apiFetch(credentials, "/api/jellyfin", { signal }, 8_000).then(response => response.json() as Promise<JellyfinStatus>),
  });
  const status = statusQuery.data ?? null;
  const result = useQuery({
    queryKey: ["jellyfin", "browse", status?.serverName, status?.username, search], enabled: connected && status?.connected === true, retry: false,
    queryFn: ({ signal }) => apiFetch(credentials, `/api/jellyfin/items?${new URLSearchParams({ q: search.query, startIndex: String(search.startIndex), resume: String(search.resume) })}`, { signal }).then(response => response.json() as Promise<JellyfinItems>),
  });
  const page = status?.connected ? result.data ?? null : null;
  const loading = connected && (statusQuery.isFetching || result.isFetching);
  const [adding, setAdding] = useState<{ id: string; playNow: boolean } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? (statusQuery.error || result.error ? message(statusQuery.error ?? result.error) : null);
  const [notice, setNotice] = useState("");
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { const operation = new AbortController(); lifetime.current = operation; setAdding(null); return () => operation.abort(); }, [origin, token, connected]);

  async function enqueue(id: string, title: string, options?: { playNow?: boolean; fromStart?: boolean }) {
    const signal = lifetime.current?.signal;
    setAdding({ id, playNow: options?.playNow === true });
    setNotice(""); setActionError(null);
    try { if (await onEnqueue(id, options) && !signal?.aborted) setNotice(options?.playNow ? `Starting ${title} on the TV.` : `Added ${title} to the queue.`); }
    catch (reason) { if (!signal?.aborted) setActionError(message(reason)); }
    finally { if (!signal?.aborted) setAdding(null); }
  }

  return <section className="min-w-0 space-y-5" aria-label="Jellyfin library">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
      <div><h2 className="break-words text-2xl font-semibold">{status?.serverName || "Jellyfin"}</h2>{status?.connected && <p className="mt-1 text-sm text-muted-foreground">Jellyfin account <strong className="font-medium text-foreground">{status.username || "the connected Jellyfin account"}</strong></p>}</div>
      <Button variant="outline" data-action="jellyfin-settings" data-tv-local-only={host ? "" : undefined} disabled={!connected} onClick={onManage}><Settings2 aria-hidden="true" />Jellyfin settings</Button>
    </div>
    {error && <Alert variant="destructive" className="rounded-none border-x-0 border-t-0 border-b border-border bg-transparent px-0"><AlertDescription>{error}<Button variant="outline" disabled={!connected || loading} onClick={() => { setActionError(null); void client.invalidateQueries({ queryKey: ["jellyfin"] }); }}>Try again</Button></AlertDescription></Alert>}
    {notice && <p className="text-sm text-primary" role="status">{notice}</p>}
    {status === null ? <p className="text-sm text-muted-foreground" role="status">{connected ? "Checking Jellyfin connection…" : "Connect to the player to use Jellyfin."}</p> : !status.connected ? <p className="border-t border-border py-4 text-sm leading-relaxed text-muted-foreground">An administrator can connect Jellyfin in Settings &gt; Sources. Every paired remote can then browse movies, episodes and music here.</p> : <>
      <Tabs value={search.resume ? "resume" : "all"} onValueChange={value => setSearch({ ...search, resume: value === "resume", startIndex: 0 })}>
        <TabsList aria-label="Jellyfin library view" className="w-full"><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="resume">Continue watching</TabsTrigger></TabsList>
        <TabsContent value={search.resume ? "resume" : "all"} className="mt-3 space-y-5">
      <form className="w-full space-y-2" role="search" onSubmit={event => { event.preventDefault(); if (query.trim() === search.query && search.startIndex === 0) void result.refetch(); else setSearch({ ...search, query: query.trim(), startIndex: 0 }); }}>
        <Label htmlFor="jellyfin-query">Search movies, episodes and music</Label>
        <div className="flex gap-2"><Input id="jellyfin-query" className="min-w-0" type="search" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="Title or artist" disabled={!connected} /><Button variant="secondary" className="secondary-button" disabled={!connected || loading}>Search</Button></div>
      </form>
      {loading && <p className="text-sm text-muted-foreground" role="status">Loading library…</p>}
      {!loading && page?.items.length === 0 && <p className="border-t border-border py-4 text-sm text-muted-foreground">{search.query ? "No matching items. Try another search." : search.resume ? "No unfinished movies, episodes or music for this Jellyfin account." : "No movies, episodes or music found in this library."}</p>}
      {!!page?.items.length && <ul aria-busy={loading}>{page.items.map(item => <li key={item.id} data-nav-row>
        <div className="space-y-3 border-b border-border py-3">
          <div className="flex min-w-0 items-center gap-3">
          <span className={`jellyfin-kind jellyfin-kind-${item.kind.toLowerCase()} grid size-11 shrink-0 place-items-center text-muted-foreground`} aria-hidden="true">{item.kind === "Audio" ? <Music2 className="size-5" /> : item.kind === "Episode" ? <Tv className="size-5" /> : <Video className="size-5" />}</span>
          <div className="min-w-0 flex-1"><h3 className="break-words text-base font-medium">{item.title}</h3><p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">{[item.detail, item.kind, duration(item.duration)].filter(Boolean).join(" · ")}</p>{(item.played || item.resumePosition > 0) && <Badge variant="secondary" className="mt-2">{item.resumePosition > 0 ? `Resume at ${position(item.resumePosition)}` : "Played"}</Badge>}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button aria-label={`${item.resumePosition > 0 ? "Resume" : "Play"} ${item.title} on TV`} disabled={!connected || !canPlay || adding !== null || loading} onClick={() => void enqueue(item.id, item.title, { playNow: true })}><Play aria-hidden="true" />{adding?.id === item.id && adding.playNow ? "Starting…" : item.resumePosition > 0 ? "Resume" : "Play"}</Button>
            <Button variant="secondary" className="secondary-button" aria-label={`Up next: ${item.title}`} disabled={!connected || adding !== null || loading} onClick={() => void enqueue(item.id, item.title)}><Plus aria-hidden="true" />{adding?.id === item.id && !adding.playNow ? "Adding…" : "Up next"}</Button>
            {item.resumePosition > 0 && <Button variant="outline" aria-label={`Play ${item.title} from start`} disabled={!connected || !canPlay || adding !== null || loading} onClick={() => void enqueue(item.id, item.title, { playNow: true, fromStart: true })}><RotateCcw aria-hidden="true" />From start</Button>}
          </div>
        </div>
      </li>)}</ul>}
      {page && page.total > 50 && <nav className="flex items-center justify-between gap-2" aria-label="Jellyfin pages"><Button variant="outline" disabled={!connected || loading || search.startIndex === 0} onClick={() => setSearch({ ...search, startIndex: Math.max(0, search.startIndex - 50) })}>Previous</Button><span className="text-center text-sm text-muted-foreground">{search.startIndex + 1}–{Math.min(search.startIndex + 50, page.total)} of {page.total}</span><Button variant="outline" disabled={!connected || loading || search.startIndex + 50 >= page.total} onClick={() => setSearch({ ...search, startIndex: search.startIndex + 50 })}>Next</Button></nav>}
        </TabsContent>
      </Tabs>
    </>}
  </section>;
}
