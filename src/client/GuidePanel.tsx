import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ListVideo, Play, Plus, Radio, Tv } from "lucide-react";
import type { GuideChannel, GuidePage, GuideProgram } from "../shared/iptv";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GuideSources, type GuideRequest } from "./GuideSources";
import "./guide.css";

type Props = { origin: string; token: string; connected: boolean; canPlay: boolean; host: boolean; version: number; controllerVersion: number; currentSource?: string; active: boolean };
const time = (value: number) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
const range = (program: GuideProgram) => `${time(program.start)} – ${time(program.end)}`;

function GuideLogo({ channel, request, version }: { channel: GuideChannel; request: GuideRequest; version: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!channel.hasLogo) return;
    const controller = new AbortController(); let objectUrl: string | undefined;
    void request(`channels/${channel.id}/logo`, { signal: controller.signal }).then(response => response.blob()).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => {});
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [channel.id, channel.hasLogo, request, version]);
  return <span className="guide-logo" aria-hidden="true">{url ? <img src={url} alt="" onError={() => setUrl(null)} /> : <Tv />}</span>;
}

export function GuidePanel({ origin, token, connected, canPlay, host, version, controllerVersion, currentSource, active }: Props) {
  const [page, setPage] = useState<GuidePage | null>(null);
  const [query, setQuery] = useState(""); const [group, setGroup] = useState(""); const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<GuideChannel | null>(null);
  const [programs, setPrograms] = useState<GuideProgram[]>([]); const [truncated, setTruncated] = useState(false);
  const [day, setDay] = useState(0); const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState("");
  const [liveEdge, setLiveEdge] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [programLoading, setProgramLoading] = useState(false);
  const playAttempt = useRef(0); const returnFocus = useRef<HTMLButtonElement | null>(null);
  const request = useCallback<GuideRequest>(async (path, init = {}) => {
    const response = await fetch(`${origin}/api/iptv/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(25_000)]) });
    if (!response.ok) { const value = await response.json().catch(() => ({})) as { error?: string }; throw new Error(value.error || "Could not load the TV guide."); }
    return response;
  }, [origin, token]);
  useEffect(() => { const timer = setInterval(() => setTick(value => value + 1), 60_000); return () => clearInterval(timer); }, []);
  useEffect(() => { setPage(null); setSelected(null); setPrograms([]); }, [origin, token]);
  useEffect(() => {
    if (!connected || !active) return;
    const controller = new AbortController(); setLoading(true);
    const timer = setTimeout(() => {
      void request(`guide?${new URLSearchParams({ q: query, group, offset: String(offset) })}`, { signal: controller.signal }).then(response => response.json() as Promise<GuidePage>).then(value => {
        if (controller.signal.aborted) return;
        setPage(value); setError(null);
        if (offset && offset >= value.total) setOffset(0);
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the guide."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [request, connected, active, version, tick, query, group, offset]);
  useEffect(() => {
    setLiveEdge(null);
    if (!active || !connected || !currentSource?.startsWith("iptv:")) return;
    const id = currentSource.slice(5); const controller = new AbortController();
    void request(`channels/${id}/capabilities`, { signal: controller.signal }).then(response => response.json() as Promise<{ liveEdge: "reload" | null }>).then(value => { if (!controller.signal.aborted && value.liveEdge) setLiveEdge(id); }).catch(() => {});
    return () => controller.abort();
  }, [request, active, connected, currentSource, version]);
  useEffect(() => {
    if (!selected || !connected) return;
    setPrograms([]); setTruncated(false); setProgramLoading(true);
    const controller = new AbortController();
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() + day);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    void request(`channels/${selected.id}/programs?start=${start.getTime()}&end=${end.getTime()}`, { signal: controller.signal }).then(response => response.json() as Promise<{ programs: GuideProgram[]; truncated: boolean }>).then(value => { if (!controller.signal.aborted) { setPrograms(value.programs); setTruncated(value.truncated); } }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load programs."); }).finally(() => { if (!controller.signal.aborted) setProgramLoading(false); });
    return () => controller.abort();
  }, [request, connected, selected, day, version]);
  async function enqueue(channel: GuideChannel, playNow: boolean) {
    const attempt = ++playAttempt.current; setError(null); setNotice("");
    try {
      await request(`channels/${channel.id}/${playNow ? "play" : "queue"}`, { method: "POST" });
      if (playAttempt.current === attempt) setNotice(playNow ? `Starting ${channel.name} on the TV.` : `${channel.name} is in the shared queue.`);
    } catch (reason) { if (playAttempt.current === attempt) setError(reason instanceof Error ? reason.message : "Could not play this channel."); }
  }
  const date = new Date(); date.setDate(date.getDate() + day);
  return <section className="guide-panel catalog-panel" aria-labelledby="guide-title">
    <div className="guide-heading"><div><h2 id="guide-title">TV guide</h2><p className="text-sm text-muted-foreground">Choose a channel to watch on the TV.</p></div><GuideSources {...{ request, origin, token, host, connected, controllerVersion }} sources={page?.sources ?? []} /></div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    {page?.sources.some(source => source.error) && <p className="text-sm text-muted-foreground">A source refresh failed. Showing its saved guide.</p>}
    {page && page.sources.length === 0 ? <p className="guide-empty">No guide sources yet. An administrator can import an M3U channel list and XMLTV programs in Guide sources.</p> : <>
      <div className="guide-filters"><div><Label htmlFor="guide-search">Channel</Label><Input id="guide-search" type="search" placeholder="Find a channel" maxLength={100} value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} /></div><div><Label htmlFor="guide-group">Group</Label><Select value={group || "all"} onValueChange={value => { setGroup(value === "all" ? "" : value); setOffset(0); }}><SelectTrigger id="guide-group"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All groups</SelectItem>{page?.groups.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select></div></div>
      <p className="text-xs text-muted-foreground">Times in {Intl.DateTimeFormat().resolvedOptions().timeZone}. {loading ? "Updating guide…" : `${page?.total ?? 0} channels`}</p>
      <ul className="guide-channel-list">{page?.channels.map(channel => <li key={channel.id} className="guide-channel" data-channel-id={channel.id}>
        <div className="guide-channel-name"><GuideLogo channel={channel} request={request} version={version} /><div><h3>{channel.name}</h3><p className="text-xs text-muted-foreground">{channel.group || "TV"}{currentSource === `iptv:${channel.id}` && " · On TV"}</p></div></div>
        <div className="guide-now-next"><p><span>Now</span>{channel.now ? <><strong>{channel.now.title}</strong><time>{range(channel.now)}</time></> : <strong>No program listed</strong>}</p><p><span>Next</span>{channel.next ? <><strong>{channel.next.title}</strong><time>{time(channel.next.start)}</time></> : <strong>No program listed</strong>}</p></div>
        <div className="guide-channel-actions"><Button disabled={!connected || !canPlay} aria-label={`Play ${channel.name}`} onClick={() => void enqueue(channel, true)}><Play aria-hidden="true" />Play</Button><Button variant="secondary" disabled={!connected} aria-label={`Queue ${channel.name}`} onClick={() => void enqueue(channel, false)}><Plus aria-hidden="true" />Queue</Button><Button variant="outline" onClick={event => { returnFocus.current = event.currentTarget; setSelected(channel); setDay(0); }}><ListVideo aria-hidden="true" />Programs</Button>{liveEdge === channel.id && <Button variant="outline" disabled={!connected || !canPlay} onClick={() => void enqueue(channel, true)} title="Reload this live HLS channel at the current live point"><Radio aria-hidden="true" />Go live</Button>}</div>
      </li>)}</ul>
      {!loading && page?.total === 0 && <p className="guide-empty">No channels match this search.</p>}
      {!!page && page.total > 50 && <nav className="flex items-center justify-between gap-3" aria-label="Guide pages"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}><ChevronLeft />Previous</Button><span className="text-sm">{offset + 1}–{Math.min(offset + 50, page.total)}</span><Button variant="outline" disabled={offset + 50 >= page.total} onClick={() => setOffset(value => value + 50)}>Next<ChevronRight /></Button></nav>}
    </>}
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="guide-program-dialog max-h-[85dvh] overflow-y-auto sm:max-w-2xl" onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}><DialogHeader><DialogTitle>{selected?.name} programs</DialogTitle><DialogDescription>Times in {Intl.DateTimeFormat().resolvedOptions().timeZone}. Programs are listings; Play starts the live channel.</DialogDescription></DialogHeader>
      <div className="guide-day"><Button variant="outline" size="icon" aria-label="Previous day" disabled={day <= -1} onClick={() => setDay(value => value - 1)}><ChevronLeft /></Button><h3>{date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</h3><Button variant="outline" size="icon" aria-label="Next day" disabled={day >= 6} onClick={() => setDay(value => value + 1)}><ChevronRight /></Button></div>
      <Button disabled={!connected || !canPlay || !selected} onClick={() => selected && void enqueue(selected, true)}><Play />Play {selected?.name} live</Button>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <ol className="guide-program-list">{programs.map(program => <li key={program.id}><time>{range(program)}</time><h3>{program.title}{program.start <= Date.now() && program.end > Date.now() && <Badge variant="secondary">Now</Badge>}</h3>{program.description && <p>{program.description}</p>}</li>)}</ol>
      {!programs.length && <p className="text-sm text-muted-foreground">{programLoading ? "Loading programs…" : "No cached programs for this day."}</p>}{truncated && <p className="text-sm text-muted-foreground">Showing the first 500 programs for this day.</p>}
    </DialogContent></Dialog>
  </section>;
}
