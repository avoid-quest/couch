import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Play, Plus, Radio } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { RadioProgrammeDetails, RadioStation } from "../../../shared/radio";
import { cancelRadioReads, radioCatalogQuery, radioProgrammesQuery } from "@/api/radio";
import { MediaArtwork } from "@/components/MediaArtwork";

type LiveEntry = { station: RadioStation; programme?: RadioProgrammeDetails };
type Credentials = { origin: string; token: string };

// What is on across avoid radio right now, programme first.
export function LiveNow({ credentials, connected, canPlay, onEnqueue, limit, active = true, rail = false, heading = "On now" }: {
  credentials: Credentials;
  connected: boolean;
  canPlay: boolean;
  onEnqueue: (station: RadioStation, playNow: boolean) => Promise<boolean>;
  limit?: number;
  active?: boolean;
  rail?: boolean;
  heading?: string;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const enabled = connected && active;
  const { data: catalog, isPending: loading, error: catalogueError } = useQuery({ ...radioCatalogQuery(credentials), enabled });
  const { data: programmes = {} } = useQuery({ ...radioProgrammesQuery(credentials), enabled, refetchInterval: 60_000 });
  useEffect(() => {
    if (enabled) return;
    void cancelRadioReads(queryClient, credentials);
  }, [credentials, enabled, queryClient]);
  const loadError = catalogueError instanceof Error ? catalogueError.message : catalogueError ? "Could not load the radio catalogue." : "";
  const message = loadError || catalog?.playlist.error || error;

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
  const retry = () => { setError(""); void queryClient.invalidateQueries({ queryKey: ["radio", "avoid"] }); };

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

  return <section className="grid min-w-0 gap-3.5" aria-label={heading}>
    <div className="flex items-baseline gap-3"><h2>{heading}</h2>{notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}</div>
    {!connected && <p role="status" className="text-sm text-muted-foreground">Connect to see what is live.</p>}
    {enabled && loading && !catalog && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-3.5" />Checking what is on…</p>}
    {enabled && loading && !catalog && <ul className={rail ? "flex gap-3.5 overflow-x-auto pb-1.5 [scrollbar-width:thin] [&>li]:w-[clamp(200px,22vw,260px)] [&>li]:shrink-0" : "grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))]"} aria-hidden="true">{Array.from({ length: rail ? 4 : 8 }, (_, index) => <li key={index}><Card className="catalog-card h-full w-full flex-col gap-2 overflow-hidden p-3"><Skeleton className="aspect-video w-full rounded-lg object-cover" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-2/5" /></Card></li>)}</ul>}
    {message && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-2"><span>{message}</span><Button variant="outline" size="sm" onClick={retry}>Retry</Button></AlertDescription></Alert>}
    {connected && catalog && shown.length > 0 && <ul className={rail ? "flex gap-3.5 overflow-x-auto pb-1.5 [scrollbar-width:thin] [&>li]:w-[clamp(200px,22vw,260px)] [&>li]:shrink-0" : "grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))]"}>
      {shown.map(({ station, programme }) => <li key={station.id}>
        <Card className="catalog-card flex h-full min-w-0 flex-col gap-2 overflow-hidden p-3">
          <Button variant="ghost" className="h-auto w-full flex-col items-stretch gap-2 p-0 text-left" aria-label={`Play: ${programme?.title ?? station.name}`} disabled={!connected || !canPlay || busy} onClick={() => void play(station)}>
            {programme?.artworkUrl || station.logoUrl
              ? <MediaArtwork key={programme?.artworkUrl || station.logoUrl} thumbnail={programme?.artworkUrl || station.logoUrl} title={programme?.title ?? station.name} className="block aspect-video w-full rounded-lg object-cover" />
              : <span className="grid aspect-video w-full place-items-center rounded-lg bg-muted text-primary" aria-hidden="true"><Radio className="size-10" /></span>}
            {programme && <small className="text-xs text-muted-foreground">{station.name}</small>}
            <strong className="text-[15px] font-semibold leading-tight [overflow-wrap:anywhere]">{programme?.title ?? station.name}</strong>
            {programme?.description && !rail && <span className="line-clamp-2 text-sm text-muted-foreground">{programme.description}</span>}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={!connected || !canPlay || busy} aria-label={`Play: ${programme?.title ?? station.name}`} onClick={() => void play(station)}><Play aria-hidden="true" />Play</Button>
            <Button variant="ghost" size="icon" disabled={!connected || busy} aria-label={`Up next: ${station.name}`} onClick={() => void queue(station)}><Plus aria-hidden="true" /></Button>
          </div>
        </Card>
      </li>)}
    </ul>}
    {connected && catalog && !shown.length && !loading && <p className="text-sm text-muted-foreground">Nothing live right now. Search or browse the tabs above.</p>}
  </section>;
}
