import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { avoidRadioPlaylistId, type RadioStation } from "../../../shared/radio";
import { radioFavoritesListQuery, radioSearchQuery } from "@/api/radio";
import { createId } from "../../session/session";
import type { SourceSetupKind } from "@/components/SourceSetupDialog";
import { readSearch, searchError, type SearchPlaybackProps, type SearchHit } from "./SearchOnlineResults";

type Props = SearchPlaybackProps & { onManageSources?: (source?: SourceSetupKind) => void; query: string; directory?: boolean; source?: "avoid radio" | "Radio playlists" | "Radio directory" };
export function SearchRadioResults(props: Props) {
  return <RadioResults key={JSON.stringify([props.origin, props.token, props.source, props.directory, props.query])} {...props} />;
}
function RadioResults(props: Props) {
  const client = useQueryClient();
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const title = props.source ?? (props.directory ? "Radio directory" : "Radio playlists");
  const directory = title === "Radio directory", avoid = title === "avoid radio";
  const options = radioSearchQuery(props, title, props.query);
  const search = useQuery({ ...options, enabled: props.connected });
  const kept = useQuery({ ...radioFavoritesListQuery(props), enabled: props.connected, retry: false });
  const stations = useMemo(() => search.data?.stations ?? [], [search.data?.stations]);
  const favorites = useMemo(() => kept.error ? null : kept.data?.favorites ?? null, [kept.error, kept.data?.favorites]);
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
  useEffect(() => {
    const hits: SearchHit[] | undefined = results.map(station => {
      const saved = !!favorites?.some(item => item.id === station.id);
      return { id: `${title}:${station.id}`, source: title, title: station.name, meta: [station.groupTitle, title].filter(Boolean).join(", "), kind: "Radio", live: true, thumbnail: station.logoUrl,
        primary: { label: "Play", disabled: !props.canPlay || busy || !props.onCommand, run: () => play(station, true) },
        actions: [
          { label: "Queue", disabled: busy || !props.onCommand, run: () => play(station, false) },
          { label: saved ? "Saved" : "Save", pressed: saved, disabled: busy || favorites === null, run: () => save(station, saved) },
        ],
      };
    });
    props.onResults?.(title, { count: results.length, loading, error: !!error, errorMessage: error, retry: () => void retry(), notice, actionError: [actionError, saveError].filter(Boolean).join(" "), facets: results.map(() => ({ kind: "Radio" })), hits });
  }, [title, stations, favorites, results.length, loading, error, notice, actionError, saveError, busy, props.onResults, props.canPlay, props.onCommand]);
  return null;
}
