import { useEffect, useRef, useState } from "react";
import type { RadioPlaylistSummary, RadioStation } from "../shared/radio";
import { Button } from "@/components/ui/button";
import { MediaArtwork } from "./ProviderPanel";
import { createId } from "./session";
import { readSearch, searchError, type SearchPlaybackProps } from "./SearchOnlineResults";

type Props = SearchPlaybackProps & { query: string; version: number; directory?: boolean };
export function SearchRadioResults(props: Props) {
  return <RadioResults key={`${props.origin}:${props.token}`} {...props} />;
}
function RadioResults(props: Props) {
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
  const title = props.directory ? "Radio directory" : "Your radio stations";
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
      if (props.directory) return (await readSearch<{ stations: RadioStation[] }>(props, `/api/radio/stations?${query}`, controller.signal)).stations;
      const { playlists } = await readSearch<{ playlists: RadioPlaylistSummary[] }>(props, "/api/radio/playlists", controller.signal);
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
  }, [props.origin, props.token, props.connected, props.query, props.directory, props.directory ? 0 : props.version, retry]);
  async function action(work: (signal: AbortSignal) => Promise<boolean | void>, done: string) {
    if (busy || !props.connected || !lifetime.current) return;
    const signal = lifetime.current.signal; setBusy(true); setActionError(""); setNotice("");
    try { const ok = await work(signal); if (!signal.aborted && ok !== false) setNotice(done); }
    catch (reason) { if (!signal.aborted) setActionError(searchError(reason)); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  function play(station: RadioStation, playNow: boolean) {
    void action(async () => await props.onCommand?.(station.sourceId ? { type: "enqueueRadio", stationId: station.id, entryId: createId(), playNow } : { type: "enqueue", entry: { id: createId(), title: station.name, source: station.url, kind: "radio" }, playNow }) ?? false, playNow ? `Starting ${station.name} on the TV.` : `${station.name} added to Up next.`);
  }
  function save(station: RadioStation, saved: boolean) {
    void action(async signal => {
      await readSearch(props, saved ? `/api/radio/favorites/${encodeURIComponent(station.id)}` : "/api/radio/favorites", signal, { method: saved ? "DELETE" : "POST", ...(saved ? {} : { body: JSON.stringify({ station }) }) });
      if (!signal.aborted) setFavorites(current => saved ? current?.filter(entry => entry.id !== station.id) ?? [] : [...current?.filter(entry => entry.id !== station.id) ?? [], station]);
    }, `${station.name} ${saved ? "removed from" : "added to"} Saved.`);
  }
  const matches = (station: RadioStation) => `${station.name} ${station.groupTitle ?? ""}`.toLocaleLowerCase().includes(props.query.toLocaleLowerCase());
  const results = props.directory ? stations : [...new Map([...stations, ...(favorites ?? []).filter(matches)].map(station => [station.id, station])).values()];
  return <section aria-label={`${title} search results`} aria-busy={loading} className="search-source"><div className="search-source-heading"><h2>{title}</h2></div>
    {loading && <p role="status">Searching {title.toLowerCase()}…</p>}
    {error && <p role="alert">{error} <Button variant="outline" disabled={!props.connected || loading} onClick={() => setRetry(value => value + 1)}>Retry {title}</Button></p>}
    {saveError && <p role="status">Saved status unavailable. {saveError} <Button variant="outline" disabled={!props.connected} onClick={() => setRetry(value => value + 1)}>Retry saved status</Button></p>}
    {!loading && !error && !results.length && <p className="text-muted-foreground">{props.directory ? "No matching stations in the directory." : "No matching stations in your radio sources."}</p>}
    {actionError && <p role="alert">{actionError}</p>}{notice && <p role="status">{notice}</p>}
    <ul className="search-results">{results.slice(0, visible).map(station => {
      const saved = !!favorites?.some(item => item.id === station.id);
      return <li key={station.id} className="search-result-row"><MediaArtwork thumbnail={station.logoUrl} title={station.name} className="search-result-art" /><div className="search-radio-copy"><strong>{station.name}</strong><small>{[station.groupTitle, station.countryCode].filter(Boolean).join(" · ") || "Internet radio"}</small></div><div className="search-item-actions"><Button aria-label={`Play ${station.name}`} disabled={!props.connected || !props.canPlay || busy || !props.onCommand} onClick={() => play(station, true)}>Play</Button><Button variant="secondary" aria-label={`Add ${station.name} to Up next`} disabled={!props.connected || busy || !props.onCommand} onClick={() => play(station, false)}>Up next</Button><Button variant="ghost" aria-label={saved ? `Remove ${station.name} from saved` : `Save ${station.name}`} aria-pressed={saved} disabled={!props.connected || busy || favorites === null} onClick={() => save(station, saved)}>{saved ? "Saved" : "Save"}</Button></div></li>;
    })}</ul>
    {results.length > visible && <Button variant="outline" onClick={() => setVisible(value => value + 6)}>Show more {title.toLowerCase()}</Button>}
  </section>;
}
