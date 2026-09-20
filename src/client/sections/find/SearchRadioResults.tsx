import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { avoidRadioPlaylistId, type RadioStation } from "../../../shared/radio";
import { radioFavoritesListQuery, radioSearchQuery } from "@/api/radio";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "@/components/MediaArtwork";
import { createId } from "../../session/session";
import type { SourceSetupKind } from "@/components/SourceSetupDialog";
import { readSearch, searchError, type SearchPlaybackProps } from "./SearchOnlineResults";

type Props = SearchPlaybackProps & { onManageSources?: (source?: SourceSetupKind) => void; query: string; directory?: boolean; source?: "avoid radio" | "Radio playlists" | "Radio directory" };
export function SearchRadioResults(props: Props) {
  return <RadioResults key={JSON.stringify([props.origin, props.token, props.source, props.directory, props.query])} {...props} />;
}
function RadioResults(props: Props) {
  const client = useQueryClient();
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreDetailFocus = useRef(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(6);
  const lifetime = useRef<AbortController | null>(null);
  const title = props.source ?? (props.directory ? "Radio directory" : "Radio playlists");
  const directory = title === "Radio directory", avoid = title === "avoid radio";
  const options = radioSearchQuery(props, title, props.query);
  const search = useQuery({ ...options, enabled: props.connected });
  const kept = useQuery({ ...radioFavoritesListQuery(props), enabled: props.connected, retry: false });
  const stations = search.data?.stations ?? [];
  const favorites = kept.error ? null : kept.data?.favorites ?? null;
  const loading = props.connected && search.isFetching;
  const error = search.error ? searchError(search.error) : search.data?.error ?? "";
  const saveError = kept.error ? searchError(kept.error) : "";
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; setBusy(false); return () => controller.abort(); }, [props.origin, props.token, props.connected]);

  async function retry() {
    await client.invalidateQueries({ queryKey: options.queryKey, exact: true, refetchType: "none" });
    await client.fetchQuery({ ...radioSearchQuery(props, title, props.query, avoid), staleTime: 0 }).catch(() => {});
  }
  async function action(work: (signal: AbortSignal) => Promise<boolean | void>, done: string) {
    if (busy || !props.connected || !lifetime.current) return;
    const signal = lifetime.current.signal; setBusy(true); setActionError(""); setNotice("");
    try { const ok = await work(signal); if (!signal.aborted && ok !== false) setNotice(done); }
    catch (reason) { if (!signal.aborted) setActionError(searchError(reason)); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  function play(station: RadioStation, playNow: boolean) {
    void action(async () => await props.onCommand?.(station.sourceId ? { type: "enqueueRadio", stationId: station.id, entryId: createId(), playNow } : { type: "enqueue", entry: { id: createId(), title: station.name, source: station.url, kind: "radio" }, playNow }) ?? false, playNow ? `Starting ${station.name} on the playback computer.` : `${station.name} added to the end of Up next. Playback is unchanged.`);
  }
  function save(station: RadioStation, saved: boolean) {
    void action(async signal => {
      await readSearch(props, saved ? `/api/radio/favorites/${encodeURIComponent(station.id)}` : "/api/radio/favorites", signal, { method: saved ? "DELETE" : "POST", ...(saved ? {} : { body: JSON.stringify({ station }) }) });
      if (!signal.aborted) await client.invalidateQueries({ queryKey: ["radio", "favorites"] });
    }, `${station.name} ${saved ? "removed." : "kept."}`);
  }
  const matches = (station: RadioStation) => !!station.sourceId && station.sourceId !== avoidRadioPlaylistId && `${station.name} ${station.groupTitle ?? ""}`.toLocaleLowerCase().includes(props.query.toLocaleLowerCase());
  const stationIds = new Set(stations.map(station => station.id));
  const results = directory || avoid ? stations : [...stations, ...(favorites ?? []).filter(station => matches(station) && !stationIds.has(station.id))];
  const detail = results.find(station => station.id === detailId);
  useEffect(() => { props.onResults?.(title, { count: results.length, loading, error: !!error }); }, [results.length, loading, error, props.onResults, title]);
  useEffect(() => {
    if (!props.active) {
      if (detail) { restoreDetailFocus.current = true; setDetailId(null); }
      return;
    }
    if (!restoreDetailFocus.current) return;
    const frame = requestAnimationFrame(() => {
      if (detailTrigger.current?.isConnected && !detailTrigger.current.closest("[hidden]")
        && !document.querySelector('[role="dialog"][data-state="open"], [role="listbox"], [data-slot="popover-content"][data-state="open"]')) detailTrigger.current.focus({ preventScroll: true });
      restoreDetailFocus.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [props.active, detail]);
  const itemActions = (station: RadioStation) => {
    const saved = !!favorites?.some(item => item.id === station.id);
    return <div className="flex flex-wrap items-center gap-1"><Button aria-label={`Play: ${station.name}`} disabled={!props.connected || !props.canPlay || busy || !props.onCommand} onClick={() => play(station, true)}>Play</Button><Button variant="secondary" aria-label={`Up next: ${station.name}`} disabled={!props.connected || busy || !props.onCommand} onClick={() => play(station, false)}>Up next</Button><Button variant="ghost" aria-label={saved ? `Remove ${station.name}` : `Keep ${station.name}`} aria-pressed={saved} disabled={!props.connected || busy || favorites === null} onClick={() => save(station, saved)}>{saved ? "Kept" : "Keep"}</Button></div>;
  };
  return <section aria-label={`${title} search results`} aria-busy={loading} className="grid gap-3.5 border-t py-6 first:border-t-0 first:pt-3"><div className="flex items-baseline justify-between gap-3"><h2 className="text-[13px] font-semibold tracking-[.01em] text-muted-foreground">{title}</h2></div>
    {loading && <p role="status">Searching {title.toLowerCase()}…</p>}
    {error && <p role="alert">{error} <Button variant="outline" disabled={!props.connected || loading} onClick={() => void retry()}>Retry {title}</Button></p>}
    {error && !directory && !avoid && (props.onManageSources ? <Button variant="outline" onClick={() => props.onManageSources?.("radio")}>Source settings</Button> : <p className="text-sm text-muted-foreground">Ask an administrator to manage this source.</p>)}
    {saveError && <p role="status">Kept status unavailable. {saveError} <Button variant="outline" disabled={!props.connected} onClick={() => void kept.refetch()}>Retry kept status</Button></p>}
    {!loading && !error && !results.length && <p className="text-muted-foreground">{`No matching stations in ${title}.`}</p>}
    {actionError && <p role="alert">{actionError}</p>}{notice && <p role="status">{notice}</p>}
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-x-4 gap-y-5">{results.slice(0, visible).map(station => <li key={station.id} className="flex min-w-0 flex-col"><MediaArtwork thumbnail={station.logoUrl} title={station.name} /><div className="grid gap-1 px-0.5 pb-0 pt-2.5"><Button variant="ghost" className="flex min-h-11 min-w-0 flex-1 flex-col items-start gap-1 p-0 text-left leading-normal whitespace-normal" aria-label={`Details for ${station.name}`} onClick={event => { detailTrigger.current = event.currentTarget; setDetailId(station.id); }}><strong className="text-[15px] font-semibold leading-tight break-words">{station.name}</strong><small className="text-xs text-muted-foreground">{[station.groupTitle, station.countryCode].filter(Boolean).join(" · ") || "Internet radio"}</small></Button></div>{itemActions(station)}</li>)}</ul>
    <Dialog open={props.active && !!detail} onOpenChange={open => { if (!open) setDetailId(null); }}><DialogContent onCloseAutoFocus={event => { event.preventDefault(); if (props.active && detailTrigger.current?.isConnected && !detailTrigger.current?.closest("[hidden]") && !document.querySelector('[role="dialog"][data-state="open"], [role="listbox"], [data-slot="popover-content"][data-state="open"]')) detailTrigger.current.focus({ preventScroll: true }); }}>{detail && <><MediaArtwork thumbnail={detail.logoUrl} title={detail.name} className="h-auto aspect-[1.9] w-full" /><DialogHeader><DialogTitle>{detail.name}</DialogTitle><DialogDescription>{title} · Live</DialogDescription></DialogHeader><p>{[detail.groupTitle, detail.countryCode, detail.codec, detail.bitrate && `${detail.bitrate} kbps`].filter(Boolean).join(" · ")}</p>{itemActions(detail)}{actionError && <p role="alert">{actionError}</p>}{notice && <p role="status">{notice}</p>}</>}</DialogContent></Dialog>
    {results.length > visible && <Button variant="outline" onClick={() => setVisible(value => value + 6)}>Show more {title.toLowerCase()}</Button>}
  </section>;
}
