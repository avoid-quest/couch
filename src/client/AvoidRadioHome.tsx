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

export function AvoidRadioHome(props: AvoidRadioHomeProps) {
  return <AvoidRadioDiscovery key={`${props.origin}\0${props.token}`} {...props} />;
}

function AvoidRadioDiscovery({ origin, token, connected, canPlay, version, onEnqueue, onBrowse, currentStationId, active = true }: AvoidRadioHomeProps) {
  const headingId = useId();
  const [catalog, setCatalog] = useState<AvoidRadioCatalog | null>(null);
  const [programmes, setProgrammes] = useState<Record<string, RadioProgrammeDetails>>({});
  const [favorites, setFavorites] = useState<RadioStation[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const catalogRequest = useRef<AbortController | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const detail = catalog?.stations.find(station => station.id === detailId);
  const hasStations = !!catalog?.stations.length;

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  function focusTrigger() {
    if (trigger.current?.isConnected && !trigger.current.closest("[hidden], [inert]")
      && !document.querySelector('[role="dialog"][data-state="open"], [role="listbox"], [data-slot="popover-content"][data-state="open"]')) trigger.current.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!active) {
      if (detailId) { restoreFocus.current = true; setDetailId(null); }
      return;
    }
    if (!restoreFocus.current || loading) return;
    const frame = requestAnimationFrame(() => { focusTrigger(); restoreFocus.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [active, detailId, loading]);

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

  const loadCatalog = useCallback((refresh = false) => {
    catalogRequest.current?.abort();
    const controller = new AbortController();
    catalogRequest.current = controller;
    setLoading(true);
    void request(`avoid${refresh ? "?refresh=true" : ""}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(response => response.json() as Promise<AvoidRadioCatalog>)
      .then(body => {
        if (controller.signal.aborted) return;
        setCatalog(body); setError(body.playlist.error ?? "");
        setDetailId(current => body.stations.some(station => station.id === current) ? current : null);
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load avoid radio."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, [request]);

  useEffect(() => {
    if (!connected || !active) { setLoading(false); return; }
    loadCatalog();
    return () => catalogRequest.current?.abort();
  }, [loadCatalog, connected, active, version]);

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
    if (!connected || !active || !hasStations) return;
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
  }, [request, connected, active, hasStations]);

  useEffect(() => {
    if (!connected || !active || !Object.keys(programmes).length) return;
    const expiresAt = Math.min(...Object.values(programmes).map(programme => programme.expiresAt));
    const timer = setTimeout(() => setProgrammes(current => Object.fromEntries(Object.entries(current).filter(([, programme]) => programme.expiresAt > Date.now()))), Math.max(1, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [programmes, connected, active]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  async function action(station: RadioStation, kind: "play" | "queue" | "favorite") {
    const signal = lifetime.current!.signal;
    const saved = favorites.some(value => value.id === station.id);
    setBusy(true); setActionError(""); setNotice("");
    try {
      if (kind === "favorite") {
        await request(saved ? `favorites/${station.id}` : "favorites", { method: saved ? "DELETE" : "POST", body: saved ? undefined : JSON.stringify({ station }), signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
        if (signal.aborted) return;
        setFavorites(previous => saved ? previous.filter(value => value.id !== station.id) : [...previous, station]);
        setNotice(`${station.name} ${saved ? "removed from" : "saved to"} favorites.`);
      } else if (await onEnqueue(station, kind === "play") && !signal.aborted) {
        setNotice(kind === "play" ? `Starting ${station.name}.` : `${station.name} added to queue.`);
      }
    } catch (reason) {
      if (!signal.aborted) setActionError(reason instanceof Error ? reason.message : "Could not complete the radio request.");
    } finally { if (!signal.aborted) setBusy(false); }
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
    {error && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><p>{error}</p><Button variant="outline" disabled={!connected || loading} onClick={() => loadCatalog(true)}>Retry avoid radio</Button></AlertDescription></Alert>}
    {actionError && <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {catalog && !loading && !catalog.stations.length && !error && <p className="text-sm text-muted-foreground">No stations are available from avoid radio right now.</p>}
    <ul className="radio-grid">{catalog?.stations.map(station => {
      const current = programme(station);
      return <li key={station.id} className="min-w-0"><Card className="catalog-card h-full justify-between gap-3 p-3">
        <Button variant="ghost" className="h-auto w-full flex-col items-stretch gap-3 p-0 text-left whitespace-normal" aria-label={`Details: ${station.name}`} onClick={event => { trigger.current = event.currentTarget; setDetailId(station.id); }}>
          <Artwork key={current?.artworkUrl || station.logoUrl || station.id} station={station} programme={current} />
          <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{station.name}<Badge variant="secondary">{connected && currentStationId === station.id ? "Playing" : "Live"}</Badge></span>
          <strong className="line-clamp-2 text-base font-medium">{current?.title || station.name}</strong>
          {current?.description && <span className="line-clamp-2 text-sm text-muted-foreground">{current.description}</span>}
        </Button>
        {actions(station)}
      </Card></li>;
    })}</ul>
    <Dialog open={active && !!detail} onOpenChange={open => { if (!open) setDetailId(null); }}><DialogContent onCloseAutoFocus={event => { event.preventDefault(); if (active) focusTrigger(); }}>
      <DialogHeader><DialogTitle>{detail?.name}</DialogTitle><DialogDescription>Live radio · avoid radio</DialogDescription></DialogHeader>
      {detail && <><Artwork key={detailProgramme?.artworkUrl || detail.logoUrl || detail.id} station={detail} programme={detailProgramme} expanded />
        {detailProgramme ? <div className="space-y-2"><h3 className="text-lg font-medium">{detailProgramme.title}</h3>{detailProgramme.description && <p className="text-sm text-muted-foreground">{detailProgramme.description}</p>}{detailProgramme.programmeUrl && <a className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={detailProgramme.programmeUrl} target="_blank" rel="noreferrer">Programme details</a>}</div> : <p className="text-sm text-muted-foreground">Programme information is unavailable. You can still play this station.</p>}
        {actions(detail)}{actionError && <p role="alert">{actionError}</p>}{notice && <p role="status">{notice}</p>}
      </>}
    </DialogContent></Dialog>
  </section>;
}
