import { useQuery } from "@tanstack/react-query";
import { radioFavoritesListQuery, radioProgrammesQuery, radioSearchQuery } from "@/api/radio";
import { useDurationClock } from "@/components/DurationBar";
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
