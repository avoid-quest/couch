import type { RadioStation } from "../../../shared/radio";
import { Card } from "@/components/ui/card";
import { RadioStationActions } from "./RadioStationActions";
import { StationArtwork } from "./StationArtwork";

type Props = {
  stations: RadioStation[];
  favorites: RadioStation[];
  connected: boolean;
  canPlay: boolean;
  busyId: string | null;
  onPlay: (station: RadioStation) => void;
  onQueue: (station: RadioStation) => void;
  onFavorite: (station: RadioStation, saved: boolean) => void;
};

export function RadioStationList({ stations, favorites, connected, canPlay, busyId, onPlay, onQueue, onFavorite }: Props) {
  return <ul className="grid list-none gap-3 p-0 [grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),1fr))]">
    {stations.map(station => {
      const saved = favorites.some(favorite => favorite.id === station.id);
      const busy = busyId === station.id;
      return <li className="min-w-0" key={station.id}>
        <Card className="h-full justify-between gap-3 p-3 transition-shadow focus-within:ring-1 focus-within:ring-ring">
          <div className="flex items-center gap-3"><StationArtwork key={station.logoUrl || station.id} station={station} /><div className="min-w-0"><h3 className="line-clamp-2 break-words text-base font-medium" title={station.name}>{station.name}</h3><p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{[station.groupTitle, station.countryCode, station.codec, station.bitrate ? `${station.bitrate} kbps` : ""].filter(Boolean).join(" · ") || "Internet radio"}</p></div></div>
          <RadioStationActions station={station} saved={saved} connected={connected} canPlay={canPlay} busy={busy} onPlay={() => onPlay(station)} onQueue={() => onQueue(station)} onFavorite={() => onFavorite(station, saved)} />
        </Card>
      </li>;
    })}
  </ul>;
}
