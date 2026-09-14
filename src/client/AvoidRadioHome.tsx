import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AvoidRadioCatalog, RadioProgrammeDetails, RadioStation } from "../shared/radio";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Play, Plus, Radio, Star } from "lucide-react";

export type AvoidRadioHomeProps = {
  origin: string;
  token: string;
  connected: boolean;
  canPlay: boolean;
  version: number;
  onEnqueue: (station: RadioStation, playNow: boolean) => Promise<boolean>;
  onBrowse?: () => void;
  currentStationId?: string;
  active?: boolean;
};

function Artwork({ station, programme, expanded = false }: { station: RadioStation; programme?: RadioProgrammeDetails; expanded?: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = programme?.artworkUrl || station.logoUrl;
  return src && !failed
    ? <img className={`${expanded ? "aspect-square w-full" : "aspect-video w-full"} rounded-lg bg-muted object-cover`} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className={`${expanded ? "aspect-square" : "aspect-video"} grid w-full place-items-center rounded-lg bg-muted text-primary`} aria-hidden="true"><Radio className="size-12" /></span>;
}

export function AvoidRadioHome({ origin, token, connected, canPlay, version, onEnqueue, onBrowse, currentStationId, active = true }: AvoidRadioHomeProps) {
  const headingId = useId();
  const [catalog, setCatalog] = useState<AvoidRadioCatalog | null>(null);
  const [programmes, setProgrammes] = useState<Record<string, RadioProgrammeDetails>>({});
  const [favorites, setFavorites] = useState<RadioStation[]>([]);
  const [detail, setDetail] = useState<RadioStation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const identity = `${origin}\0${token}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${origin}/api/radio/${path}`, {
      ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || "Could not load avoid radio. Try again.");
    }
    return response;
  }, [origin, token]);

  useEffect(() => {
    setCatalog(null); setProgrammes({}); setFavorites([]); setDetail(null); setError(""); setActionError(""); setNotice(""); setBusy(false);
  }, [identity]);

  useEffect(() => {
    if (!connected || !active) return;
    const controller = new AbortController();
    setLoading(true);
    void request(`avoid${attempt ? "?refresh=true" : ""}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(response => response.json() as Promise<AvoidRadioCatalog>)
      .then(body => { if (!controller.signal.aborted) { setCatalog(body); setError(body.playlist.error ?? ""); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load avoid radio."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request, connected, active, attempt]);

  useEffect(() => {
    if (!connected || !active) return;
    const controller = new AbortController();
    void request("favorites", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) })
      .then(response => response.json() as Promise<{ favorites: RadioStation[] }>)
      .then(body => { if (!controller.signal.aborted) setFavorites(body.favorites); })
      .catch(reason => { if (!controller.signal.aborted) setActionError(reason instanceof Error ? reason.message : "Could not load favorites."); });
    return () => controller.abort();
  }, [request, connected, active, version]);

  useEffect(() => {
    if (!connected || !active || !catalog?.stations.length) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try {
        const response = await request("avoid/programmes", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]) });
        const body = await response.json() as { programmes: Record<string, RadioProgrammeDetails> };
        if (!controller.signal.aborted) setProgrammes(body.programmes);
      } catch { /* Stations remain playable when programme data is unavailable. */ }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => { void refresh(); }, 60_000); }
    }
    void refresh();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [request, connected, active, catalog]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  async function action(station: RadioStation, kind: "play" | "queue" | "favorite") {
    const destination = identity;
    const saved = favorites.some(value => value.id === station.id);
    setBusy(true); setActionError(""); setNotice("");
    try {
      if (kind === "favorite") {
        await request(saved ? `favorites/${station.id}` : "favorites", { method: saved ? "DELETE" : "POST", body: saved ? undefined : JSON.stringify({ station }) });
        if (currentIdentity.current !== destination) return;
        setFavorites(previous => saved ? previous.filter(value => value.id !== station.id) : [...previous, station]);
        setNotice(`${station.name} ${saved ? "removed from" : "saved to"} favorites.`);
      } else if (await onEnqueue(station, kind === "play") && currentIdentity.current === destination) {
        setNotice(kind === "play" ? `Starting ${station.name}.` : `${station.name} added to queue.`);
      }
    } catch (reason) {
      if (currentIdentity.current === destination) setActionError(reason instanceof Error ? reason.message : "Could not complete the radio request.");
    } finally { if (currentIdentity.current === destination) setBusy(false); }
  }

  const actions = (station: RadioStation) => {
    const saved = favorites.some(value => value.id === station.id);
    return <div className="flex flex-wrap items-center gap-2">
      <Button disabled={!connected || !canPlay || busy} aria-label={`Play now: ${station.name}`} onClick={() => void action(station, "play")}><Play aria-hidden="true" />Play now</Button>
      <Button variant="secondary" disabled={!connected || busy} aria-label={`Add to queue: ${station.name}`} onClick={() => void action(station, "queue")}><Plus aria-hidden="true" />Add to queue</Button>
      <Button variant="ghost" size="icon" disabled={!connected || busy} aria-label={`${saved ? "Unsave" : "Save"} ${station.name}`} aria-pressed={saved} onClick={() => void action(station, "favorite")}><Star aria-hidden="true" className={saved ? "fill-current" : ""} /></Button>
    </div>;
  };
  const programme = (station: RadioStation) => {
    const value = programmes[station.id];
    return connected && value && value.expiresAt > Date.now() ? value : undefined;
  };
  const detailProgramme = detail ? programme(detail) : undefined;

  return <section className="space-y-4" aria-labelledby={headingId}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id={headingId} className="text-xl font-medium">avoid radio</h2>{onBrowse && <Button variant="ghost" onClick={onBrowse}>All radio</Button>}</div>
    {loading && !catalog && <p role="status" className="text-sm text-muted-foreground">Loading stations…</p>}
    {!connected && <p role="status" className="text-sm text-muted-foreground">Connect to a playback computer to load radio.</p>}
    {error && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><p>{error}</p><Button variant="outline" disabled={!connected || loading} onClick={() => setAttempt(value => value + 1)}>Retry avoid radio</Button></AlertDescription></Alert>}
    {actionError && <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {catalog && !loading && !catalog.stations.length && !error && <p className="text-sm text-muted-foreground">No stations are available from avoid radio right now.</p>}
    <ul className="radio-grid">{catalog?.stations.map(station => {
      const current = programme(station);
      return <li key={station.id} className="min-w-0"><Card className="catalog-card h-full justify-between gap-3 p-3">
        <Button variant="ghost" className="h-auto w-full flex-col items-stretch gap-3 p-0 text-left whitespace-normal" aria-label={`Details: ${station.name}`} onClick={event => { trigger.current = event.currentTarget; setDetail(station); }}>
          <Artwork key={current?.artworkUrl || station.logoUrl || station.id} station={station} programme={current} />
          <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{station.name}<Badge variant="secondary">{connected && currentStationId === station.id ? "Playing" : "Live"}</Badge></span>
          <strong className="line-clamp-2 text-base font-medium">{current?.title || station.name}</strong>
          {current?.description && <span className="line-clamp-2 text-sm text-muted-foreground">{current.description}</span>}
        </Button>
        {actions(station)}
      </Card></li>;
    })}</ul>
    <Dialog open={!!detail} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus(); }}>
      <DialogHeader><DialogTitle>{detail?.name}</DialogTitle><DialogDescription>Live radio · avoid radio</DialogDescription></DialogHeader>
      {detail && <><Artwork key={detailProgramme?.artworkUrl || detail.logoUrl || detail.id} station={detail} programme={detailProgramme} expanded />
        {detailProgramme ? <div className="space-y-2"><h3 className="text-lg font-medium">{detailProgramme.title}</h3>{detailProgramme.description && <p className="text-sm text-muted-foreground">{detailProgramme.description}</p>}{detailProgramme.programmeUrl && <a className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={detailProgramme.programmeUrl} target="_blank" rel="noreferrer">Programme details</a>}</div> : <p className="text-sm text-muted-foreground">Programme information is unavailable. You can still play this station.</p>}
        {actions(detail)}{actionError && <p role="alert">{actionError}</p>}{notice && <p role="status">{notice}</p>}
      </>}
    </DialogContent></Dialog>
  </section>;
}
