import { playbackStatus } from "@/playback-status";
import { browserActions } from "@/original-page";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "@/api/client";
import { radioFavoritesListQuery, radioProgrammesQuery, radioSearchQuery } from "@/api/radio";
import { useRadioClock } from "@/radio-clock";
import { usePlayOn } from "@/components/PlayOn";
import type { MenuAction } from "@/components/RowMenu";
import { itemLocation, useDetailNavigation } from "@/detail-navigation";
import { failed } from "@/toasts";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import { isRadio, radioNow, freshRadioProgramme, radioShowLabels, type RadioProgrammeDetails, type RadioStation } from "../../../shared/radio";
import { metaLine } from "@/media-caption";

/**
 * The stations on air: `first` (this device's recents), then the saved stations, then the built-in ones, each once and
 * with its current show.
 */
export function useOnAir(enabled = true, first: RadioStation[] = []) {
  const { credentials, current } = useShell();
  const { connected, state } = useSessionGate();
  const favorites = useQuery({ ...radioFavoritesListQuery(credentials), enabled: connected && enabled });
  // Built-in stations fill the shelf, so a fresh Couch opens on something playable.
  const builtIn = useQuery({ ...radioSearchQuery(credentials, "avoid radio", ""), enabled: connected && enabled });
  const once = (stations: RadioStation[]) => stations.filter((station, index, all) => all.findIndex(other => other.id === station.id) === index);
  const mine = once([...first, ...favorites.data?.favorites ?? []]);
  const stations = once([...mine, ...builtIn.data?.stations ?? []]);
  const programmesShown = connected && enabled;
  const programmes = useQuery({ ...radioProgrammesQuery(credentials), enabled: programmesShown, refetchInterval: 60_000 });
  const now = useRadioClock(Object.values(programmes.data ?? {}));
  const show = (id: string) => radioNow(programmes.data?.[id], id, now);
  const playing = (station: RadioStation) => current?.kind === "radio" && (current.source === `radio:${station.id}` || current.source === station.url);
  return {
    stations, show, playing, favorites, builtIn,
    pending: enabled && (favorites.isPending || builtIn.isPending || programmesShown && programmes.isPending),
    /** The stations themselves are still loading; their shows may follow (a tile keeps room for one). */
    loading: enabled && (favorites.isPending || builtIn.isPending),
    /** Playing, then the show and its categories, else the station's tags. */
    meta: (station: RadioStation) => { const on = show(station.id); return metaLine(playing(station) && playbackStatus(state, connected).label, ...on ? [on.title, ...radioShowLabels(on)] : station.tags ?? []); },
  };
}

/** Save and Saved for a station, its favourite toggled: radio Details' verb, and every station tile's. */
export function useStationSave() {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  const client = useQueryClient();
  const favorites = useQuery({ ...radioFavoritesListQuery(credentials), enabled: connected });
  const toggle = useMutation({
    mutationFn: async ({ station, saved }: { station: RadioStation; saved: boolean }) => {
      await (saved ? apiSend(credentials, `/api/radio/favorites/${encodeURIComponent(station.id)}`, undefined, "DELETE") : apiSend(credentials, "/api/radio/favorites", { station }));
      await client.invalidateQueries({ queryKey: radioFavoritesListQuery(credentials).queryKey });
    },
    onError: (error, { station, saved }) => failed(`Couldn't ${saved ? "remove" : "save"} ${station.name}.`, error),
  });
  return (station: RadioStation) => {
    const saved = !!favorites.data?.favorites.some(favorite => favorite.id === station.id);
    return { saved, disabled: !connected || !favorites.data || toggle.isPending, run: () => toggle.mutate({ station, saved }) };
  };
}

/**
 * A station tile's menu, its Details' verbs: Details itself (the tile's press plays), Queue, Save or Saved, and Play
 * on. A station played from a link may be in no list, so its tile is where it can be saved.
 */
export function useStationMenu() {
  const { available, enqueueRadio } = useShell();
  const { connected } = useSessionGate();
  const details = useDetailNavigation();
  const { play } = usePlayOn();
  const save = useStationSave();
  return (station: RadioStation): MenuAction[] => {
    const favorite = save(station);
    return [
      { label: "Details", run: () => details.open(itemLocation("radio", station.id)) },
      { label: "Queue", disabled: !connected, run: () => void enqueueRadio(station, false) },
      { label: favorite.saved ? "Saved" : "Save", pressed: favorite.saved, disabled: favorite.disabled, run: favorite.run },
      ...browserActions(station.homepage),
      { label: "Play on", disabled: !available, playOn: deviceId => void play(on => enqueueRadio(station, true, on), deviceId) },
    ];
  };
}

/**
 * A playing station's show: Core's programme for the playback, else the show its tile shows, so its title and artwork
 * (the show's photo, else the station's logo) are the same on the tile, the now-playing bar, Home's hero and the player,
 * while it loads as while it plays. Null for anything but a station on air.
 */
export function useStationShow(): RadioProgrammeDetails | null {
  const { credentials, current, programme } = useShell();
  const { connected, state } = useSessionGate();
  const station = isRadio(current) && current?.source.startsWith("radio:") ? current.source.slice(6) : null;
  const programmes = useQuery({ ...radioProgrammesQuery(credentials), enabled: connected && !!station, refetchInterval: 60_000 });
  const now = useRadioClock(Object.values(programmes.data ?? {}), programme);
  if (programme && programme.playbackId === state?.player.playbackId && freshRadioProgramme(programme, now)) return programme;
  const listed = station ? programmes.data?.[station] : undefined;
  return station ? radioNow(listed, station, now) : null;
}
