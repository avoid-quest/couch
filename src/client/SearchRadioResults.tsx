import { useEffect, useRef, useState } from "react";
import { avoidRadioPlaylistId, type AvoidRadioCatalog, type RadioPlaylistSummary, type RadioStation } from "../shared/radio";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "./ProviderPanel";
import { createId } from "./session";
import { readSearch, searchError, type SearchPlaybackProps } from "./SearchOnlineResults";

type Props = SearchPlaybackProps & { query: string; version: number; directory?: boolean; source?: "avoid radio" | "Radio playlists" | "Radio directory" };
export function SearchRadioResults(props: Props) {
  return <RadioResults key={`${props.origin}:${props.token}`} {...props} />;
}
function RadioResults(props: Props) {
  const [detail, setDetail] = useState<RadioStation | null>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [favorites, setFavorites] = useState<RadioStation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [visible, setVisible] = useState(6);
  const lifetime = useRef<AbortController | null>(null);
  const previousSearch = useRef("");
  const title = props.source ?? (props.directory ? "Radio directory" : "Radio playlists");
  const directory = title === "Radio directory", avoid = title === "avoid radio";
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; setBusy(false); return () => controller.abort(); }, [props.origin, props.token, props.connected]);
  useEffect(() => {
    if (!props.connected) { setFavorites(null); return; }
    const controller = new AbortController(); setSaveError("");
    void readSearch<{ favorites: RadioStation[] }>(props, "/api/radio/favorites", controller.signal).then(body => { if (!controller.signal.aborted) setFavorites(body.favorites); }).catch(reason => { if (!controller.signal.aborted) { setFavorites(null); setSaveError(searchError(reason)); } });
    return () => controller.abort();
  }, [props.origin, props.token, props.connected, props.version, retry]);
  useEffect(() => {
    if (!props.connected) { setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setError("");
    const key = JSON.stringify([props.origin, props.token, props.query]);
    if (previousSearch.current !== key) { previousSearch.current = key; setStations([]); setVisible(6); }
    async function load() {
      if (props.query.length > 100) throw new Error("Search radio with at most 100 characters.");
      const query = new URLSearchParams({ q: props.query });
      if (avoid) {
        const { playlist, stations } = await readSearch<AvoidRadioCatalog>(props, `/api/radio/avoid${retry ? "?refresh=true" : ""}`, controller.signal);
        if (!controller.signal.aborted && playlist?.error) setError(playlist.error);
        return stations.filter(station => `${station.name} ${station.groupTitle ?? ""}`.toLocaleLowerCase().includes(props.query.toLocaleLowerCase()));
      }
      if (directory) return (await readSearch<{ stations: RadioStation[] }>(props, `/api/radio/stations?${query}`, controller.signal)).stations;
      const { playlists: allPlaylists } = await readSearch<{ playlists: RadioPlaylistSummary[] }>(props, "/api/radio/playlists", controller.signal);
      const playlists = allPlaylists.filter(playlist => playlist.id !== avoidRadioPlaylistId);
      const results: RadioStation[][] = Array.from({ length: playlists.length }, () => []);
      const failures: string[] = [];
      let index = 0;
      // Keep configured-source reads bounded even when the TV has many playlists.
      await Promise.all(Array.from({ length: Math.min(3, playlists.length) }, async () => {
        while (index < playlists.length && !controller.signal.aborted) {
          const current = index++; const playlist = playlists[current]!;
          try { results[current] = (await readSearch<{ stations: RadioStation[] }>(props, `/api/radio/playlists/${encodeURIComponent(playlist.id)}/stations?${query}`, controller.signal)).stations; }
          catch (reason) { failures.push(`${playlist.name}: ${searchError(reason)}`); }
        }
      }));
      if (!controller.signal.aborted && failures.length) setError(failures.join(" "));
      return [...new Map(results.flat().map(station => [station.id, station])).values()];
    }
    void load().then(result => { if (!controller.signal.aborted) setStations(result); }).catch(reason => { if (!controller.signal.aborted) setError(searchError(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [props.origin, props.token, props.connected, props.query, title, directory ? 0 : props.version, retry]);
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
      if (!signal.aborted) setFavorites(current => saved ? current?.filter(entry => entry.id !== station.id) ?? [] : [...current?.filter(entry => entry.id !== station.id) ?? [], station]);
    }, `${station.name} ${saved ? "removed from" : "added to"} Saved.`);
  }
  const matches = (station: RadioStation) => station.sourceId !== avoidRadioPlaylistId && `${station.name} ${station.groupTitle ?? ""}`.toLocaleLowerCase().includes(props.query.toLocaleLowerCase());
  const results = directory || avoid ? stations : [...new Map([...stations, ...(favorites ?? []).filter(matches)].map(station => [station.id, station])).values()];
  useEffect(() => { props.onResults?.(title, { count: results.length, loading, error: !!error }); }, [results.length, loading, error, props.onResults, title]);
  useEffect(() => { if (!props.active) setDetail(null); }, [props.active]);
  const itemActions = (station: RadioStation) => {
    const saved = !!favorites?.some(item => item.id === station.id);
    return <div className="search-item-actions"><Button aria-label={`Play now: ${station.name}`} disabled={!props.connected || !props.canPlay || busy || !props.onCommand} onClick={() => play(station, true)}>Play now</Button><Button variant="secondary" aria-label={`Add to queue: ${station.name}`} disabled={!props.connected || busy || !props.onCommand} onClick={() => play(station, false)}>Add to queue</Button><Button variant="ghost" aria-label={saved ? `Remove ${station.name} from saved` : `Save ${station.name}`} aria-pressed={saved} disabled={!props.connected || busy || favorites === null} onClick={() => save(station, saved)}>{saved ? "Saved" : "Save"}</Button></div>;
  };
  return <section aria-label={`${title} search results`} aria-busy={loading} className="search-source"><div className="search-source-heading"><h2>{title}</h2></div>
    {loading && <p role="status">Searching {title.toLowerCase()}…</p>}
    {error && <p role="alert">{error} <Button variant="outline" disabled={!props.connected || loading} onClick={() => setRetry(value => value + 1)}>Retry {title}</Button></p>}
    {saveError && <p role="status">Saved status unavailable. {saveError} <Button variant="outline" disabled={!props.connected} onClick={() => setRetry(value => value + 1)}>Retry saved status</Button></p>}
    {!loading && !error && !results.length && <p className="text-muted-foreground">{`No matching stations in ${title}.`}</p>}
    {actionError && <p role="alert">{actionError}</p>}{notice && <p role="status">{notice}</p>}
    <ul className="search-results">{results.slice(0, visible).map(station => <li key={station.id} className="search-result-row"><MediaArtwork thumbnail={station.logoUrl} title={station.name} className="search-result-art" /><Button variant="ghost" className="search-result-title" aria-label={`Details for ${station.name}`} onClick={event => { detailTrigger.current = event.currentTarget; setDetail(station); }}><strong>{station.name}</strong><small>{[station.groupTitle, station.countryCode].filter(Boolean).join(" · ") || "Internet radio"}</small></Button>{itemActions(station)}</li>)}</ul>
    <Dialog open={props.active && !!detail} onOpenChange={open => { if (!open) setDetail(null); }}><DialogContent onCloseAutoFocus={event => { event.preventDefault(); if (props.active && detailTrigger.current?.isConnected) detailTrigger.current.focus({ preventScroll: true }); }}>{detail && <><DialogHeader><DialogTitle>{detail.name}</DialogTitle><DialogDescription>{title} · Live</DialogDescription></DialogHeader><p>{[detail.groupTitle, detail.countryCode, detail.codec, detail.bitrate && `${detail.bitrate} kbps`].filter(Boolean).join(" · ")}</p>{itemActions(detail)}{actionError && <p role="alert">{actionError}</p>}{notice && <p role="status">{notice}</p>}</>}</DialogContent></Dialog>
    {results.length > visible && <Button variant="outline" onClick={() => setVisible(value => value + 6)}>Show more {title.toLowerCase()}</Button>}
  </section>;
}
