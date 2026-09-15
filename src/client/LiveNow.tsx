import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Plus, Radio } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { AvoidRadioCatalog, RadioProgrammeDetails, RadioStation } from "../shared/radio";
import { MediaArtwork } from "./ProviderPanel";
import "./live-now.css";

type LiveEntry = { station: RadioStation; programme?: RadioProgrammeDetails };

// What is on across avoid radio right now, programme first.
export function LiveNow({ origin, token, connected, canPlay, version, onEnqueue, limit, active = true, rail = false, heading = "On now" }: {
  origin: string;
  token: string;
  connected: boolean;
  canPlay: boolean;
  version: number;
  onEnqueue: (station: RadioStation, playNow: boolean) => Promise<boolean>;
  limit?: number;
  active?: boolean;
  rail?: boolean;
  heading?: string;
}) {
  const [catalog, setCatalog] = useState<AvoidRadioCatalog | null>(null);
  const [programmes, setProgrammes] = useState<Record<string, RadioProgrammeDetails>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(active && connected);
  const [busy, setBusy] = useState(false);
  const lifetime = useRef(new AbortController());

  useEffect(() => {
    if (!active) { lifetime.current.abort(); return; }
    const controller = lifetime.current = new AbortController();
    return () => controller.abort();
  }, [active]);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${origin}/api/radio/${path}`, {
      ...init, headers: { Authorization: `Bearer ${token}` },
      signal: init.signal ?? AbortSignal.any([lifetime.current.signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Could not load the radio catalogue.");
    return response;
  }, [origin, token]);

  useEffect(() => {
    if (!connected || !active) { setLoading(false); return; }
    const controller = lifetime.current;
    setLoading(true); setError("");
    void request("avoid", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(response => response.json() as Promise<AvoidRadioCatalog>)
      .then(body => { if (!controller.signal.aborted) { setCatalog(body); setError(body.playlist.error ?? ""); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the radio catalogue."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, [request, connected, active, version]);

  useEffect(() => {
    if (!connected || !active) return;
    const controller = lifetime.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const response = await request("avoid/programmes", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]) });
        const body = await response.json() as { programmes: Record<string, RadioProgrammeDetails> };
        if (!controller.signal.aborted) setProgrammes(body.programmes);
      } catch { /* Stations still play without programme data. */ }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 60_000); }
    };
    void refresh();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [request, connected, active]);

  const play = async (station: RadioStation) => {
    if (busy) return;
    setBusy(true);
    try { if (await onEnqueue(station, true)) setNotice(`Starting ${station.name}.`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start the station."); }
    finally { setBusy(false); }
  };
  const queue = async (station: RadioStation) => {
    if (busy) return;
    setBusy(true);
    try { if (await onEnqueue(station, false)) setNotice(`${station.name} added to Up next.`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add the station."); }
    finally { setBusy(false); }
  };

  const entries: LiveEntry[] = [];
  for (const station of catalog?.stations ?? []) {
    const programme = programmes[station.id];
    if (programme?.expiresAt && programme.expiresAt > Date.now()) entries.push({ station, programme });
  }
  for (const station of catalog?.stations ?? []) {
    const programme = programmes[station.id];
    if (!programme || programme.expiresAt <= Date.now()) entries.push({ station });
  }
  const shown = limit ? entries.slice(0, limit) : entries;

  return <section className={rail ? "live-now live-rail" : "live-now live-grid"} aria-label={heading}>
    <div className="live-heading"><h2>{heading}</h2>{notice && <p role="status" className="live-notice">{notice}</p>}</div>
    {!connected && <p role="status" className="text-sm text-muted-foreground">Connect to see what is live.</p>}
    {connected && loading && !catalog && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-3.5" />Checking what is on…</p>}
    {connected && loading && !catalog && <ul className={rail ? "live-cards live-cards-rail" : "live-cards"} aria-hidden="true">{Array.from({ length: rail ? 4 : 8 }, (_, index) => <li key={index}><Card className="catalog-card h-full gap-3 p-3"><Skeleton className="aspect-video w-full rounded-lg" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-2/5" /></Card></li>)}</ul>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {connected && catalog && shown.length > 0 && <ul className={rail ? "live-cards live-cards-rail" : "live-cards"}>
      {shown.map(({ station, programme }) => <li key={station.id}>
        <Card className="catalog-card live-card h-full gap-2 p-3">
          <Button variant="ghost" className="h-auto w-full flex-col items-stretch gap-2 p-0 text-left" aria-label={`Play now: ${programme?.title ?? station.name}`} disabled={!connected || !canPlay || busy} onClick={() => void play(station)}>
            {programme?.artworkUrl || station.logoUrl
              ? <MediaArtwork key={programme?.artworkUrl || station.logoUrl} thumbnail={programme?.artworkUrl || station.logoUrl} title={programme?.title ?? station.name} className="live-art" />
              : <span className="live-art live-art-placeholder grid place-items-center" aria-hidden="true"><Radio className="size-10" /></span>}
            {programme && <small className="live-station">{station.name}</small>}
            <strong className="line-clamp-2">{programme?.title ?? station.name}</strong>
            {programme?.description && !rail && <span className="line-clamp-2 text-sm text-muted-foreground">{programme.description}</span>}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={!connected || !canPlay || busy} aria-label={`Play now: ${programme?.title ?? station.name}`} onClick={() => void play(station)}><Play aria-hidden="true" />Play now</Button>
            <Button variant="ghost" size="icon" disabled={!connected || busy} aria-label={`Add to queue: ${station.name}`} onClick={() => void queue(station)}><Plus aria-hidden="true" /></Button>
          </div>
        </Card>
      </li>)}
    </ul>}
    {connected && catalog && !shown.length && !loading && <p className="text-sm text-muted-foreground">Nothing live right now. Search or browse the tabs above.</p>}
  </section>;
}
