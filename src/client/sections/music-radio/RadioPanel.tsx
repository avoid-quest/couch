import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RadioStation } from "../../../shared/radio";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioDirectory } from "./RadioDirectory";
import { RadioStationList } from "./RadioStationList";
import { AvoidRadioHome } from "./AvoidRadioHome";
import { PlaylistRadioPanel } from "./PlaylistRadioPanel";
import { radioFavoritesQuery, saveRadioFavorite } from "./radioQueries";

type Props = {
  credentials: { origin: string; token: string };
  connected: boolean;
  host: boolean;
  onManage: () => void;
  canPlay: boolean;
  onEnqueue: (station: RadioStation, playNow: boolean) => Promise<boolean>;
  active?: boolean;
  currentStationId?: string;
};

export function RadioPanel({ credentials, connected, host, onManage, canPlay, onEnqueue, active = true, currentStationId }: Props) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const favorites = useQuery(radioFavoritesQuery(credentials, connected));
  const favoriteStations = favorites.data?.favorites ?? [];

  const favorite = async (station: RadioStation, saved: boolean) => {
    setBusyId(station.id); setError("");
    try {
      await saveRadioFavorite(credentials, station, saved, AbortSignal.timeout(15_000));
      void queryClient.invalidateQueries({ queryKey: ["radio"] });
      setNotice(`${station.name} ${saved ? "removed from" : "saved to"} favorites.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The radio request failed.");
    } finally { setBusyId(null); }
  };
  const play = async (station: RadioStation, playNow: boolean) => {
    setBusyId(station.id); setError("");
    try {
      if (await onEnqueue(station, playNow)) setNotice(playNow ? `Starting ${station.name}.` : `${station.name} added to queue.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The radio request failed.");
    } finally { setBusyId(null); }
  };

  return <section className="min-w-0 space-y-5" aria-labelledby="radio-title">
    <div><h2 id="radio-title" className="text-2xl font-semibold">Internet radio</h2><p className="mt-1 text-sm text-muted-foreground">Your stations, ready to play.</p></div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <p className="text-sm text-primary" role="status">{notice}</p>}
    {favoriteStations.length > 0 && <div className="space-y-3"><h3 className="flex items-center gap-2 text-base font-medium">Favorites <Badge variant="secondary">{favoriteStations.length}</Badge></h3>
      <RadioStationList stations={favoriteStations} favorites={favoriteStations} connected={connected} canPlay={canPlay} busyId={busyId} onPlay={station => void play(station, true)} onQueue={station => void play(station, false)} onFavorite={favorite} />
    </div>}
    <AvoidRadioHome key={`${credentials.origin}\0${credentials.token}`} credentials={credentials} connected={connected} canPlay={canPlay} onEnqueue={onEnqueue} active={active} currentStationId={currentStationId} />
    <PlaylistRadioPanel credentials={credentials} connected={connected} canPlay={canPlay} host={host} onManage={onManage} favorites={favoriteStations} busyId={busyId} onPlay={station => void play(station, true)} onQueue={station => void play(station, false)} onFavorite={favorite} />
    {!favoriteStations.length && <p className="text-sm text-muted-foreground">Star a station to keep it at the top of your radio.</p>}
    <RadioDirectory credentials={credentials} connected={connected} canPlay={canPlay} favorites={favoriteStations} busyId={busyId} onPlay={station => void play(station, true)} onQueue={station => void play(station, false)} onFavorite={favorite} />
  </section>;
}
