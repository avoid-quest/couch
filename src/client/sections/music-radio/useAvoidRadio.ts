import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RadioProgrammeDetails, RadioStation } from "../../../shared/radio";
import type { Credentials } from "../../session/session";
import { avoidRadioQuery, radioFavoritesQuery, radioRequest, saveRadioFavorite } from "./radioQueries";

type AvoidAction = (station: RadioStation, kind: "play" | "queue" | "favorite") => Promise<void>;

export function useAvoidRadio(credentials: Credentials, connected: boolean, active: boolean, onEnqueue: (station: RadioStation, playNow: boolean) => Promise<boolean>) {
  const queryClient = useQueryClient();
  const [refresh, setRefresh] = useState(0);
  const [programmes, setProgrammes] = useState<Record<string, RadioProgrammeDetails>>({});
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const catalog = useQuery(avoidRadioQuery(credentials, connected && active, refresh));
  const favorites = useQuery(radioFavoritesQuery(credentials, connected && active));
  const stations = catalog.data?.stations ?? [];

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!connected || !active || !stations.length) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const response = await radioRequest(credentials, "avoid/programmes", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]) });
        const body = await response.json() as { programmes: Record<string, RadioProgrammeDetails> };
        if (!controller.signal.aborted) setProgrammes(body.programmes);
      } catch { /* Stations remain playable when programme data is unavailable. */ }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 60_000); }
    }
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [credentials, connected, active, stations.length]);

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

  const action = useCallback<AvoidAction>(async (station, kind) => {
    const signal = lifetime.current!.signal;
    const saved = (favorites.data?.favorites ?? []).some(value => value.id === station.id);
    setBusy(true); setActionError(""); setNotice("");
    try {
      if (kind === "favorite") {
        await saveRadioFavorite(credentials, station, saved, signal);
        if (signal.aborted) return;
        void queryClient.invalidateQueries({ queryKey: ["radio"] });
        setNotice(`${station.name} ${saved ? "removed from" : "saved to"} favorites.`);
      } else if (await onEnqueue(station, kind === "play") && !signal.aborted) {
        setNotice(kind === "play" ? `Starting ${station.name}.` : `${station.name} added to queue.`);
      }
    } catch (reason) {
      if (!signal.aborted) setActionError(reason instanceof Error ? reason.message : "Could not complete the radio request.");
    } finally { if (!signal.aborted) setBusy(false); }
  }, [credentials, favorites.data, onEnqueue, queryClient]);

  return {
    catalog: catalog.data ?? null,
    favorites: favorites.data?.favorites ?? [],
    programmes,
    loading: catalog.isFetching && !catalog.data,
    error: catalog.error?.message ?? catalog.data?.playlist.error ?? "",
    actionError, notice, busy, refresh: () => setRefresh(value => value + 1),
    action,
  };
}
