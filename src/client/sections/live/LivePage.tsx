import { useQuery } from "@tanstack/react-query";
import { iptvSourcesQuery } from "@/api/iptv";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MediaTile } from "@/components/MediaTile";
import { usePlayOn } from "@/components/PlayOn";
import { Shelf } from "@/components/Shelf";
import { BrowseRadio } from "@/sections/find/BrowseRadio";
import { BrowseLiveTv } from "@/sections/find/BrowseLiveTv";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { useKeptOrder } from "@/sections/home/home-rows";
import { TRY_AGAIN } from "@/copy";
import { useOnAir } from "./on-air";

/** Live: what's on air at the saved and built-in stations, then every station, then the channels once a Live TV source has some. */
export function LivePage() {
  const { credentials, available, section, enqueueRadio } = useShell();
  const { connected, run } = useSessionGate();
  const { on } = usePlayOn();
  const iptv = useQuery({ ...iptvSourcesQuery(credentials), enabled: connected });
  const onAir = useOnAir();
  // As on Home, the shelf keeps the order it opened with, so a refetch or a new favourite never moves a tile under the focus.
  const stations = useKeptOrder(onAir.stations, station => station.id, !onAir.pending);
  return <section data-page="Live" aria-label="Live" className="grid min-w-0 gap-12">
    <h1 className="sr-only">Live</h1>
    {/* It waits for the shows, so its tiles don't grow a line under the focus. */}
    {!onAir.pending && !!stations.length && <Shelf title="On air" time={`${stations.length} ${stations.length === 1 ? "station" : "stations"}`}>
      {/* Tiles take the shelf's height, so one without a show stays level with the rest and Up and Down leave the shelf. */}
      {stations.map((station, index) => <li key={station.id} className="flex shrink-0">
        <MediaTile data-page-first={index === 0 || undefined} className="justify-start" shape="square" title={station.name} meta={onAir.meta(station) || undefined} thumbnail={onAir.show(station.id)?.artworkUrl ?? station.logoUrl}
          aria-label={on(`Play ${station.name}`)} disabled={!available} onClick={() => void enqueueRadio(station, true)} />
      </li>)}
    </Shelf>}
    {/* A failed list leaves its stations out, so say so; missing shows only cost the tiles their meta line. */}
    {(onAir.favorites.error || onAir.builtIn.error) && <Alert variant="destructive"><AlertDescription>Couldn't load On air.</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void Promise.all([onAir.favorites.refetch(), onAir.builtIn.refetch()])}>{TRY_AGAIN}</Button></AlertAction></Alert>}
    <BrowseRadio origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active={section === "Live"} onCommand={run} />
    {iptv.data?.sources.some(source => source.channelCount) && <BrowseLiveTv />}
    {iptv.error && !iptv.data && <Alert variant="destructive"><AlertDescription>Couldn't load Live TV.</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void iptv.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}
  </section>;
}
