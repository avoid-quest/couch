import { Play, Plus, Star } from "lucide-react";
import type { RadioStation } from "../../../shared/radio";
import { Button } from "@/components/ui/button";

type Props = {
  station: RadioStation;
  saved: boolean;
  connected: boolean;
  canPlay: boolean;
  busy: boolean;
  onPlay: () => void;
  onQueue: () => void;
  onFavorite: () => void;
};

export function RadioStationActions({ station, saved, connected, canPlay, busy, onPlay, onQueue, onFavorite }: Props) {
  return <div className="flex flex-wrap items-center gap-2">
    <Button disabled={!connected || !canPlay || busy} aria-label={`Play now: ${station.name}`} onClick={onPlay}><Play aria-hidden="true" />Play now</Button>
    <Button variant="secondary" disabled={!connected || busy} aria-label={`Add to queue: ${station.name}`} onClick={onQueue}><Plus aria-hidden="true" />Add to queue</Button>
    <Button variant="ghost" size="icon" disabled={!connected || busy} aria-label={`${saved ? "Unsave" : "Save"} ${station.name}`} aria-pressed={saved} onClick={onFavorite}><Star aria-hidden="true" className={saved ? "fill-current" : ""} /></Button>
  </div>;
}
