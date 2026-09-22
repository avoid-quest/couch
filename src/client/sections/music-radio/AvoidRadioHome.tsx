import { useEffect, useId, useRef, useState } from "react";
import type { RadioStation } from "../../../shared/radio";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AvoidRadioArtwork } from "./AvoidRadioArtwork";
import { RadioStationList } from "./RadioStationList";
import { RadioStationActions } from "./RadioStationActions";
import { useAvoidRadio } from "./useAvoidRadio";

type Props = {
  credentials: { origin: string; token: string };
  connected: boolean;
  canPlay: boolean;
  onEnqueue: (station: RadioStation, playNow: boolean) => Promise<boolean>;
  onBrowse?: () => void;
  currentStationId?: string;
  active?: boolean;
  limit?: number;
};

export function AvoidRadioHome(props: Props) {
  const radio = useAvoidRadio(props.credentials, props.connected, props.active !== false, props.onEnqueue);
  const headingId = useId();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const detail = radio.catalog?.stations.find(station => station.id === detailId);

  useEffect(() => { setLoading(radio.loading); }, [radio.loading]);
  useEffect(() => {
    if (props.active !== false) return;
    if (detailId) { restoreFocus.current = true; setDetailId(null); }
  }, [props.active, detailId]);
  useEffect(() => {
    if (props.active === false || loading || !restoreFocus.current) return;
    const frame = requestAnimationFrame(() => {
      if (trigger.current?.isConnected && !trigger.current.closest("[hidden], [inert]")
        && !document.querySelector('[role="dialog"][data-state="open"], [role="listbox"], [data-slot="popover-content"][data-state="open"]')) trigger.current.focus({ preventScroll: true });
      restoreFocus.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [props.active, detailId, loading]);


  return <section className="space-y-4" aria-labelledby={headingId}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id={headingId} className="text-xl font-medium">avoid radio</h2>{props.onBrowse && <Button variant="ghost" onClick={props.onBrowse}>All radio</Button>}</div>
    {loading && !radio.catalog && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-3.5" />Loading stations…</p>}
    {loading && !radio.catalog && <ul className="grid list-none gap-3 p-0 [grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),1fr))]">
      {Array.from({ length: 4 }, (_, index) => <li key={index}><Card className="h-full gap-3 p-3"><Skeleton className="aspect-video w-full rounded-lg" /><Skeleton className="h-4 w-2/5" /><Skeleton className="h-5 w-3/4" /><Skeleton className="h-3 w-full" /></Card></li>)}
    </ul>}
    {!props.connected && <p role="status" className="text-sm text-muted-foreground">Connect to a playback computer to load radio.</p>}
    {radio.error && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><p>{radio.error}</p><Button variant="outline" disabled={!props.connected || loading} onClick={radio.refresh}>Retry avoid radio</Button></AlertDescription></Alert>}
    {radio.actionError && <Alert variant="destructive"><AlertDescription>{radio.actionError}</AlertDescription></Alert>}
    {radio.notice && <p role="status" className="text-sm text-muted-foreground">{radio.notice}</p>}
    {radio.catalog && !loading && !radio.catalog.stations.length && !radio.error && <p className="text-sm text-muted-foreground">No stations are available from avoid radio right now.</p>}
    {radio.catalog && <ul className="grid list-none gap-3 p-0 [grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),1fr))]">
      {radio.catalog.stations.slice(0, props.limit).map(station => {
        const current = props.connected ? radio.programmes[station.id] : undefined;
        const live = current && current.expiresAt > radio.now ? current : undefined;
        return <li key={station.id} className="min-w-0"><Card className="h-full justify-between gap-3 p-3">
          <Button variant="ghost" className="h-auto w-full flex-col items-stretch gap-3 p-0 text-left whitespace-normal" aria-label={`Details: ${station.name}`} onClick={event => { trigger.current = event.currentTarget; setDetailId(station.id); }}>
            <AvoidRadioArtwork key={live?.artworkUrl || station.logoUrl || station.id} station={station} programme={live} />
            <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{station.name}<Badge variant="secondary">{props.connected && props.currentStationId === station.id ? "Playing" : "Live"}</Badge></span>
            <strong className="line-clamp-2 text-base font-medium">{live?.title || station.name}</strong>
            {live?.description && <span className="line-clamp-2 text-sm text-muted-foreground">{live.description}</span>}
          </Button>
          <RadioStationActions station={station} saved={radio.favorites.some(favorite => favorite.id === station.id)} connected={props.connected} canPlay={props.canPlay} busy={radio.busy} onPlay={() => void radio.action(station, "play")} onQueue={() => void radio.action(station, "queue")} onFavorite={() => void radio.action(station, "favorite")} />
        </Card></li>;
      })}
    </ul>}
    <Dialog open={detailId !== null && !!detail} onOpenChange={open => { if (!open) setDetailId(null); }}><DialogContent onCloseAutoFocus={event => { event.preventDefault(); if (props.active !== false) trigger.current?.focus({ preventScroll: true }); }}>
      <DialogHeader><DialogTitle>{detail?.name}</DialogTitle><DialogDescription>Live radio · avoid radio</DialogDescription></DialogHeader>
      {detail && (() => {
        const current = props.connected ? radio.programmes[detail.id] : undefined;
        const programme = current && current.expiresAt > radio.now ? current : undefined;
        return <>
          <AvoidRadioArtwork key={programme?.artworkUrl || detail.logoUrl || detail.id} station={detail} programme={programme} expanded />
          {programme ? <div className="space-y-2"><h3 className="text-lg font-medium">{programme.title}</h3>{programme.description && <p className="text-sm text-muted-foreground">{programme.description}</p>}{programme.programmeUrl && <a className="inline-flex min-h-11 items-center text-sm underline underline-offset-4" href={programme.programmeUrl} target="_blank" rel="noreferrer">Programme details</a>}</div> : <p className="text-sm text-muted-foreground">Programme information is unavailable. You can still play this station.</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={!props.connected || !props.canPlay || radio.busy} onClick={() => void radio.action(detail, "play")}>Play</Button>
            <Button variant="secondary" disabled={!props.connected || radio.busy} onClick={() => void radio.action(detail, "queue")}>Up next</Button>
            <RadioStationActions station={detail} saved={radio.favorites.some(favorite => favorite.id === detail.id)} connected={props.connected} canPlay={props.canPlay} busy={radio.busy} onPlay={() => void radio.action(detail, "play")} onQueue={() => void radio.action(detail, "queue")} onFavorite={() => void radio.action(detail, "favorite")} />
          </div>
          {radio.actionError && <p role="alert">{radio.actionError}</p>}{radio.notice && <p role="status">{radio.notice}</p>}
        </>;
      })()}
    </DialogContent></Dialog>
  </section>;
}
