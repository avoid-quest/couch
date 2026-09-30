import { useCallback, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { radioStationQuery } from "@/api/radio";
import { useShell } from "@/sections/shell/shell-context";
import { useSessionGate } from "@/session/session-context";
import { HitList, SourceProblems } from "@/sections/find/SearchPanel";
import { SearchRadioResults } from "@/sections/find/SearchRadioResults";
import type { SearchResultSummary } from "@/sections/find/SearchOnlineResults";
import { radioBrowseLocation } from "@/radio-navigation";
import { Spinner } from "@/components/ui/spinner";
import { avoidRadioPlaylistId, type RadioStation } from "../../shared/radio";

export function RelatedRadio({ stationId, station: known }: { stationId?: string; station?: RadioStation }) {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  const query = useQuery({ ...radioStationQuery(credentials, stationId ?? ""), enabled: connected && !!stationId && !known });
  const station = known ?? query.data;
  if (stationId && !station && query.isPending && connected) return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-3.5" />Loading stations…</p>;
  return <RadioItems key={station?.sourceId ?? "directory"} station={station} />;
}

function RadioItems({ station }: { station?: RadioStation }) {
  const { credentials, available } = useShell();
  const { connected, run } = useSessionGate();
  const source = station?.sourceId === avoidRadioPlaylistId ? "avoid radio" : station?.sourceId ? "Radio playlists" : "Radio directory";
  const [summary, setSummary] = useState<SearchResultSummary | null>(null);
  const report = useCallback((_: string, summary: SearchResultSummary) => setSummary(summary), []);
  const hits = (summary?.hits ?? []).filter(hit => !station || hit.id !== `${source}:${station.id}`);
  return <section aria-label="More stations" className="mt-6 min-w-0 space-y-2">
    <h2 className="text-sm text-muted-foreground"><Link to={radioBrowseLocation(source)} className="inline-flex min-h-8 items-center hover:text-foreground hover:underline">More stations</Link></h2>
    <SearchRadioResults browse source={source} query="" onResults={report} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active onCommand={run} />
    {!connected && <p role="status" className="text-sm text-muted-foreground">Connect to Couch to load stations.</p>}
    {summary?.loading && !hits.length && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-3.5" />Loading stations…</p>}
    <HitList hits={hits.slice(0, 4)} timeline={false} label="More stations" />
    {summary && !summary.loading && !summary.error && !hits.length && <p className="text-sm text-muted-foreground">No other stations are available from this source.</p>}
    <SourceProblems summaries={summary ? [[source, summary]] : []} />
  </section>;
}
