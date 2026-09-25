import type { RadioStation } from "../../../shared/radio";
import { Item } from "@/components/ui/item";
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
  return <ul className="list-none p-0">
    {stations.map(station => {
      const saved = favorites.some(favorite => favorite.id === station.id);
      const busy = busyId === station.id;
      return <Item asChild key={station.id} className="min-w-0 justify-between gap-4 rounded-none border-0 border-b border-border bg-transparent px-0 py-4"><li>
          <div className="flex items-center gap-3"><StationArtwork key={station.logoUrl || station.id} station={station} /><div className="min-w-0"><h3 className="line-clamp-2 break-words text-base font-medium" title={station.name}>{station.name}</h3><p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{[station.groupTitle, station.countryCode, station.codec, station.bitrate ? `${station.bitrate} kbps` : ""].filter(Boolean).join(" · ") || "Internet radio"}</p></div></div>
          <RadioStationActions station={station} saved={saved} connected={connected} canPlay={canPlay} busy={busy} onPlay={() => onPlay(station)} onQueue={() => onQueue(station)} onFavorite={() => onFavorite(station, saved)} />
      </li></Item>;
    })}
  </ul>;
}
