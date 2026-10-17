import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "@/api/client";
import { radioFavoritesListQuery, radioProgrammesQuery, radioSearchQuery } from "@/api/radio";
import { useDurationClock } from "@/components/DurationBar";
import { usePlayOn } from "@/components/PlayOn";
import type { MenuAction } from "@/components/RowMenu";
import { itemLocation, useDetailNavigation } from "@/detail-navigation";
import { failed } from "@/toasts";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import { avoidRadioPlaylistId, type RadioStation } from "../../../shared/radio";

/**
 * The stations on air, for Home's Radio shelf and Live's On air shelf: `first` (Home's recents), then the saved
 * stations, then the built-in ones, each once and with its current show.
 */
export function useOnAir(enabled = true, first: RadioStation[] = []) {
  const { credentials, current } = useShell();
  const { connected } = useSessionGate();
  const now = useDurationClock();
  const favorites = useQuery({ ...radioFavoritesListQuery(credentials), enabled: connected && enabled });
  // Built-in stations fill the shelf, so a fresh Couch opens on something playable.
  const builtIn = useQuery({ ...radioSearchQuery(credentials, "avoid radio", ""), enabled: connected && enabled });
  const stations = [...first, ...favorites.data?.favorites ?? [], ...builtIn.data?.stations ?? []].filter((station, index, all) => all.findIndex(other => other.id === station.id) === index);
  const programmesShown = connected && enabled && stations.some(station => station.sourceId === avoidRadioPlaylistId);
  const programmes = useQuery({ ...radioProgrammesQuery(credentials), enabled: programmesShown, refetchInterval: 60_000 });
  // A show's expiresAt is when its data refreshes (about every 15 minutes), not when it ends, so on air reads "Live".
  const show = (id: string) => { const value = programmes.data?.[id]; return value && value.expiresAt > now ? value : undefined; };
  const playing = (station: RadioStation) => current?.kind === "radio" && (current.source === `radio:${station.id}` || current.source === station.url);
  return {
    stations, show, playing, favorites, builtIn,
    pending: enabled && (favorites.isPending || builtIn.isPending || programmesShown && programmes.isPending),
    /** Playing, then the show and its genre. */
    meta: (station: RadioStation) => [playing(station) && "Playing", show(station.id)?.title, show(station.id)?.genre].filter(Boolean).join(" · "),
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
      { label: "Play on", disabled: !available, playOn: deviceId => void play(on => enqueueRadio(station, true, on), deviceId) },
    ];
  };
}
