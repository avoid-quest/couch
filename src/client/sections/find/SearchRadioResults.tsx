import { browserActions } from "@/original-page";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { itemLocation, useDetailNavigation } from "@/detail-navigation";
import { avoidRadioPlaylistId, radioNow, radioNext, radioMatches, radioShowLabels, type RadioStation } from "../../../shared/radio";
import { radioFavoritesListQuery, radioProgrammesQuery, radioSearchQuery } from "@/api/radio";
import { useRadioClock } from "@/radio-clock";
import { createId } from "../../session/session";
import { readSearch, searchError, type SearchPlaybackProps, type SearchHit } from "./SearchOnlineResults";
import { failed } from "@/toasts";

type Props = SearchPlaybackProps & { query: string; retry?: number; browse?: boolean; source: "avoid radio" | "Radio playlists" | "Radio directory" };
export function SearchRadioResults(props: Props) {
  return <RadioResults key={JSON.stringify([props.origin, props.token, props.source, props.query])} {...props} />;
}
function RadioResults(props: Props) {
  const client = useQueryClient();
  const navigation = useDetailNavigation();
  const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const title = props.source;
  const directory = title === "Radio directory", avoid = title === "avoid radio";
  const programmes = useQuery({ ...radioProgrammesQuery(props), enabled: props.connected && props.active && !directory, refetchInterval: 60_000 });
  const now = useRadioClock(Object.values(programmes.data ?? {}));
  const options = radioSearchQuery(props, title, props.query);
  const search = useQuery({ ...options, enabled: props.connected, refetchOnMount: props.retry ? "always" : true });
  const kept = useQuery({ ...radioFavoritesListQuery(props), enabled: props.connected, retry: false });
  const stations = useMemo(() => search.data?.stations ?? [], [search.data?.stations]);
  const favorites = useMemo(() => kept.error ? null : kept.data?.favorites ?? null, [kept.error, kept.data?.favorites]);
  const loading = props.connected && search.isPending;
  const error = search.error ? searchError(search.error) : search.data?.error ?? "";
  const saveError = kept.error ? searchError(kept.error) : "";
  // Debounced summaries can still call online actions after a disconnect.
  useEffect(() => { const controller = new AbortController(); lifetime.current = props.connected ? controller : null; setBusy(false); return () => controller.abort(); }, [props.origin, props.token, props.connected]);

  async function retry() {
    await client.invalidateQueries({ queryKey: options.queryKey, exact: true, refetchType: "none" });
    await client.fetchQuery({ ...radioSearchQuery(props, title, props.query, avoid), staleTime: 0 }).catch(() => {});
  }
  async function action(failure: string, work: (signal: AbortSignal) => Promise<boolean | void>) {
    if (busy || !props.connected || !lifetime.current || lifetime.current.signal.aborted) return;
    const signal = lifetime.current.signal; setBusy(true);
    try { await work(signal); }
    catch (reason) { if (!signal.aborted) failed(failure, reason); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  function play(station: RadioStation, playNow: boolean, deviceId?: string) {
    const on = deviceId ? { deviceId } : {};
    void action(`Couldn't ${playNow ? "play" : "queue"} ${station.name}.`, async () => await props.onCommand?.(station.sourceId ? { type: "enqueueRadio", stationId: station.id, entryId: createId(), playNow, ...on } : { type: "enqueue", entry: { id: createId(), title: station.name, source: station.url, kind: "radio" }, playNow, ...on }) ?? false);
  }
  function save(station: RadioStation, saved: boolean) {
    void action(`Couldn't ${saved ? "remove" : "save"} ${station.name}.`, async signal => {
      await readSearch(props, saved ? `/api/radio/favorites/${encodeURIComponent(station.id)}` : "/api/radio/favorites", signal, { method: saved ? "DELETE" : "POST", ...(saved ? {} : { body: JSON.stringify({ station }) }) });
      if (!signal.aborted) await client.invalidateQueries({ queryKey: ["radio", "favorites"] });
    });
  }
  const matches = (station: RadioStation) => !!station.sourceId && station.sourceId !== avoidRadioPlaylistId;
  const stationIds = new Set(stations.map(station => station.id));
  const results = (directory || avoid ? stations : [...stations, ...(favorites ?? []).filter(station => matches(station) && !stationIds.has(station.id))]).filter(station => radioMatches(station, props.query, radioNow(programmes.data?.[station.id], station.id, now)));
  useLayoutEffect(() => {
    const hits: SearchHit[] | undefined = results.map(station => {
      const saved = !!favorites?.some(item => item.id === station.id);
      const value = programmes.data?.[station.id];
      const programme = radioNow(value, station.id, now);
      const next = radioNext(value, now);
      // A row says what it plays: the show and its categories, else the station's tags and group; the next show has a line of its own.
      return { id: `${title}:${station.id}`, source: title, radio: {id: station.id, title: station.name, url: station.url, tags: station.tags, categories: radioShowLabels(programme), host: programme?.artist, group: station.groupTitle, next: next && { start: next.start, title: next.title }}, title: station.name, meta: [...new Set([...programme ? [programme.title, ...radioShowLabels(programme)] : [...station.tags ?? [], station.groupTitle], title].filter(Boolean))].join(" · "), description: programme?.description, kind: "Radio", live: true, thumbnail: programme?.artworkUrl ?? station.logoUrl,
        primary: props.browse ? { label: "Open", href: itemLocation("radio", station.id), run: () => navigation.open(itemLocation("radio", station.id)) } : { label: "Play", disabled: !props.canPlay || busy || !props.onCommand, run: () => play(station, true) },
        actions: [
          ...(props.browse ? [] : [{ label: "Details", run: () => navigation.open(itemLocation("radio", station.id)) }]),
          { label: "Play", disabled: !props.canPlay || busy || !props.onCommand, run: () => play(station, true) },
          { label: "Play on", disabled: !props.canPlay || busy || !props.onCommand, playOn: (deviceId: string) => play(station, true, deviceId) },
          { label: "Queue", disabled: busy || !props.onCommand, run: () => play(station, false) },
          ...browserActions(station.homepage),
          { label: saved ? "Saved" : "Save", pressed: saved, disabled: !props.connected || busy || favorites === null, run: () => save(station, saved) },
        ],
      };
    });
    props.onResults?.(title, { count: results.length, loading, error: !!error, errorMessage: error, retry: () => void retry(), warning: saveError || undefined, hits });
  }, [title, stations, favorites, programmes.data, now, results.length, loading, error, saveError, busy, props.connected, props.onResults, props.canPlay, props.onCommand, props.browse]);
  return null;
}
