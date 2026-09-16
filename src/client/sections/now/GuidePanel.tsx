import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useDeferredValue, useRef, useState } from "react";
import { ListVideo, Play, Plus, Radio } from "lucide-react";
import type { GuideChannel, GuidePage, GuideProgram } from "../../../shared/iptv";
import type { Action } from "../../../shared/protocol";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GuideSources, type GuideRequest } from "../../GuideSources";
import { RecordingsPanel } from "../../RecordingsPanel";
import { recordingsQuery } from "../../api/recordings";
import { apiFetch } from "../../api/client";
import { createId, type Credentials } from "../../session/session";
import { GuideLogo } from "./GuideLogo";
import { GuideProgramDialog } from "./GuideProgramDialog";

type Props = { credentials: Credentials; connected: boolean; canPlay: boolean; host: boolean; currentSource?: string; onGoLive: () => void; active: boolean; run: (action: Action) => Promise<boolean> };

// The guide owns discovery and live-edge status; schedules live in their dialog.
export function GuidePanel({ credentials, connected, canPlay, host, currentSource, onGoLive, active, run }: Props) {
  const queryClient = useQueryClient();
  const [queryDraft, setQueryDraft] = useState(""); const query = useDeferredValue(queryDraft);
  const [group, setGroup] = useState(""); const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<GuideChannel | null>(null);
  const [notice, setNotice] = useState("");
  const [playError, setPlayError] = useState<string | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const request = useCallback<GuideRequest>(async (path, init = {}) => apiFetch(credentials, `/api/iptv/${path}`, init), [credentials]);
  const guide = useQuery({
    queryKey: ["iptv", "guide", { query, group, offset }],
    enabled: connected && active,
    queryFn: () => request(`guide?${new URLSearchParams({ q: query, group, offset: String(offset) })}`).then(r => r.json() as Promise<GuidePage>),
  });
  const page = guide.data;
  const liveChannelId = active && connected && currentSource?.startsWith("iptv:") ? currentSource.slice(5) : null;
  const liveEdge = useQuery({
    queryKey: ["iptv", "live-edge", liveChannelId],
    enabled: !!liveChannelId,
    queryFn: () => request(`channels/${liveChannelId}/capabilities`).then(r => r.json() as Promise<{ liveEdge: "reload" | null }>),
  });
  const recordings = useQuery({ ...recordingsQuery(credentials), enabled: connected && active });
  const recordingsRemote = {
    page: recordings.data ?? null,
    error: recordings.error instanceof Error ? recordings.error.message : recordings.error ? "Could not load recordings." : null,
    request: useCallback(async (path: string, init: RequestInit = {}) => {
      const timeout = path === "setup" ? 180_000 : path === "schedule" ? 90_000 : path.endsWith("/cancel") ? 60_000 : 30_000;
      return apiFetch(credentials, `/api/recordings${path ? `/${path}` : ""}`, { ...init, headers: { "Content-Type": "application/json", ...init.headers }, signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(timeout)]) });
    }, [credentials]),
    reload: useCallback(() => { void queryClient.invalidateQueries({ queryKey: ["recordings"] }); }, [queryClient]),
  };

  useEffect(() => {
    const timer = setInterval(() => { void queryClient.invalidateQueries({ queryKey: ["iptv", "guide"] }); }, 60_000);
    return () => clearInterval(timer);
  }, [queryClient]);
  useEffect(() => { setOffset(0); setSelected(null); setQueryDraft(""); setGroup(""); }, [credentials.origin, credentials.token]);
  useEffect(() => { if (page && offset && offset >= page.total) setOffset(0); }, [page, offset]);
  useEffect(() => { if (!guide.error) return; setNotice(""); }, [guide.error]);

  const enqueue = async (channel: GuideChannel, playNow: boolean) => {
    const action: Action = { type: "enqueue", entry: { id: createId(), title: channel.name, source: `iptv:${channel.id}`, live: true }, playNow };
    const played = await command(action);
    if (played) setNotice(playNow ? `Starting ${channel.name} on the TV.` : `${channel.name} is in the shared queue.`);
    return played;
  };
  const command = async (action: Action) => {
    setPlayError(null);
    try { return await run(action); }
    catch (reason) { setPlayError(reason instanceof Error ? reason.message : "Could not play this channel."); return false; }
  };

  return <section className="guide-panel grid min-w-0 gap-4" aria-labelledby="guide-title">
    <div className="guide-heading flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="guide-title" className="mb-1 text-2xl font-semibold">TV guide</h2><p className="text-sm text-muted-foreground">Choose a channel to watch on the TV.</p></div>
      <div className="flex flex-wrap gap-2">
        <RecordingsPanel remote={recordingsRemote} channels={page?.channels ?? []} {...{ connected, canPlay, host, origin: credentials.origin, token: credentials.token, controllerVersion: 0 }} />
        <GuideSources {...{ request, origin: credentials.origin, token: credentials.token, host, connected, controllerVersion: 0 }} sources={page?.sources ?? []} />
      </div>
    </div>
    {(playError || guide.error) && <Alert variant="destructive"><AlertDescription>{playError || (guide.error instanceof Error ? guide.error.message : "Could not load the TV guide.")}</AlertDescription></Alert>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    {page?.sources.some(source => source.error) && <p className="text-sm text-muted-foreground">A source refresh failed. Showing its saved guide.</p>}
    {page && page.sources.length === 0 ? <p className="guide-empty py-5 text-muted-foreground">No guide sources yet. An administrator can import an M3U channel list and XMLTV programs in Guide sources.</p> : <>
      <div className="guide-filters grid gap-3 [grid-template-columns:repeat(2,minmax(0,1fr))]">
        <div className="grid min-w-0 gap-2"><Label htmlFor="guide-search">Channel</Label><Input id="guide-search" type="search" placeholder="Find a channel" maxLength={100} value={queryDraft} onChange={event => { setQueryDraft(event.target.value); setOffset(0); }} /></div>
        <div className="grid min-w-0 gap-2"><Label htmlFor="guide-group">Group</Label><Select value={group ? `group:${group}` : "all"} onValueChange={value => { setGroup(value === "all" ? "" : value.slice(6)); setOffset(0); }}><SelectTrigger id="guide-group" className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All groups</SelectItem>{page?.groups.map(name => <SelectItem key={name} value={`group:${name}`}>{name}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <p className="text-xs text-muted-foreground">Times in {Intl.DateTimeFormat().resolvedOptions().timeZone}. {guide.isFetching ? "Updating guide…" : `${page?.total ?? 0} channels`}</p>
      <ul className="guide-channel-list grid gap-3">
        {page?.channels.map(channel => <li key={channel.id} className="guide-channel grid items-center gap-3 rounded-lg border bg-card p-3.5 md:[grid-template-columns:minmax(140px,.8fr)_minmax(0,1.4fr)] md:[&>.guide-channel-actions]:col-span-full lg:[grid-template-columns:minmax(150px,.7fr)_minmax(0,1.2fr)_auto] lg:[&>.guide-channel-actions]:col-span-auto lg:[&>.guide-channel-actions]:max-w-[270px]" data-channel-id={channel.id}>
          <div className="guide-channel-name flex min-w-0 items-center gap-3">
            <GuideLogo credentials={credentials} channel={channel} />
            <div className="min-w-0"><h3 className="font-semibold [overflow-wrap:anywhere]">{channel.name}</h3><p className="text-xs text-muted-foreground">{channel.group || "TV"}{currentSource === `iptv:${channel.id}` && " · On TV"}</p></div>
          </div>
          <div className="guide-now-next grid gap-3 [grid-template-columns:repeat(2,minmax(0,1fr))] [&_p]:grid [&_p]:min-w-0 [&_span]:text-xs [&_time]:text-xs [&_span]:text-muted-foreground [&_time]:text-muted-foreground [&_strong]:text-sm [&_strong]:font-medium [&_strong]:break-words">
            <p><span>Now</span>{channel.now ? <><strong>{channel.now.title}</strong><time>{range(channel.now)}</time></> : <strong>No program listed</strong>}</p>
            <p><span>Next</span>{channel.next ? <><strong>{channel.next.title}</strong><time>{time(channel.next.start)}</time></> : <strong>No program listed</strong>}</p>
          </div>
          <div className="guide-channel-actions flex flex-wrap gap-2 [&>button]:flex-auto max-md:[&>button]:flex-auto md:[&>button]:flex-none">
            <Button disabled={!connected || !canPlay} aria-label={`Play ${channel.name}`} onClick={() => void enqueue(channel, true)}><Play aria-hidden="true" />Play</Button>
            <Button variant="secondary" disabled={!connected} aria-label={`Queue ${channel.name}`} onClick={() => void enqueue(channel, false)}><Plus aria-hidden="true" />Queue</Button>
            <Button variant="outline" onClick={event => { returnFocus.current = event.currentTarget; setSelected(channel); }}><ListVideo aria-hidden="true" />Programs</Button>
            {liveEdge.data?.liveEdge === "reload" && liveChannelId === channel.id && currentSource === `iptv:${channel.id}` && <Button variant="outline" disabled={!connected || !canPlay} onClick={onGoLive} title="Return to live playback. Slow feeds may pause to buffer."><Radio aria-hidden="true" />Go live</Button>}
          </div>
        </li>)}
      </ul>
      {!guide.isFetching && page?.total === 0 && <p className="guide-empty py-5 text-muted-foreground">No channels match this search.</p>}
      {!!page && page.total > 50 && <nav className="flex items-center justify-between gap-3" aria-label="Guide pages">
        <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Previous</Button>
        <span className="text-sm">{offset + 1}–{Math.min(offset + 50, page.total)}</span>
        <Button variant="outline" disabled={offset + 50 >= page.total} onClick={() => setOffset(value => value + 50)}>Next</Button>
      </nav>}
    </>}
    {selected && <GuideProgramDialog credentials={credentials} connected={connected} canPlay={canPlay} channel={selected} recordings={recordingsRemote} onEnqueue={enqueue} onClose={() => setSelected(null)} returnFocus={() => returnFocus.current?.focus()} />}
  </section>;
}

const time = (value: number) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
const range = (program: GuideProgram) => `${time(program.start)} – ${time(program.end)}`;
