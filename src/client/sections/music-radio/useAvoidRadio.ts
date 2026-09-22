import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RadioStation } from "../../../shared/radio";
import type { Credentials } from "../../session/session";
import { cancelRadioReads, radioCatalogQuery, radioFavoritesListQuery, radioProgrammesQuery, saveRadioFavorite } from "@/api/radio";

type AvoidAction = (station: RadioStation, kind: "play" | "queue" | "favorite") => Promise<void>;

export function useAvoidRadio(credentials: Credentials, connected: boolean, active: boolean, onEnqueue: (station: RadioStation, playNow: boolean) => Promise<boolean>) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const catalog = useQuery({ ...radioCatalogQuery(credentials), enabled: connected && active });
  const favorites = useQuery({ ...radioFavoritesListQuery(credentials), enabled: connected && active });
  const programmes = useQuery({ ...radioProgrammesQuery(credentials), enabled: connected && active, refetchInterval: 60_000 });

  useEffect(() => {
    if (connected && active) return;
    void cancelRadioReads(queryClient, credentials);
  }, [active, connected, credentials, queryClient]);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

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
    programmes: programmes.data ?? {},
    loading: catalog.isFetching && !catalog.data,
    error: catalog.error?.message ?? catalog.data?.playlist.error ?? "",
    actionError, notice, busy, refresh: () => void queryClient.invalidateQueries({ queryKey: radioCatalogQuery(credentials).queryKey }),
    action,
  };
}
