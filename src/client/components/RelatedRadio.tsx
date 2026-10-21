import { MediaRowsSkeleton } from "@/components/LoadingMedia";
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
import { avoidRadioPlaylistId, type RadioStation } from "../../shared/radio";

export function RelatedRadio({ stationId, station: known }: { stationId?: string; station?: RadioStation }) {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  const query = useQuery({ ...radioStationQuery(credentials, stationId ?? ""), enabled: connected && !!stationId && !known });
  const station = known ?? query.data;
  if (stationId && !station && query.isPending && connected) return <MediaRowsSkeleton compact count={4} />;
  return <RadioItems key={station?.sourceId ?? "directory"} station={station} />;
}

function RadioItems({ station }: { station?: RadioStation }) {
  const { credentials, available } = useShell();
  const { connected, run } = useSessionGate();
  const source = station?.sourceId === avoidRadioPlaylistId ? "avoid radio" : station?.sourceId ? "Radio playlists" : "Radio directory";
  const [summary, setSummary] = useState<SearchResultSummary | null>(null);
  const report = useCallback((_: string, summary: SearchResultSummary) => setSummary(summary), []);
  const hits = (summary?.hits ?? []).filter(hit => !station || hit.id !== `${source}:${station.id}`);
  return <section aria-label="More stations" hidden={!!summary && !summary.loading && !summary.error && !hits.length} className="mt-10 min-w-0 space-y-4">
    <h2 className="text-xl font-semibold tracking-tight"><Link data-text-link to={radioBrowseLocation(source)} className="inline-flex min-h-8 items-center hover:text-foreground hover:underline">More stations</Link></h2>
    <SearchRadioResults browse source={source} query="" onResults={report} origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} active onCommand={run} />
    {!connected && <p role="status" className="text-sm text-muted-foreground">Connect to Couch to load stations.</p>}
    {summary?.loading && !hits.length && <MediaRowsSkeleton compact count={4} />}
    <HitList showSource={false} hits={hits.slice(0, 4)} compact label="More stations" />
    <SourceProblems summaries={summary ? [[source, summary]] : []} />
  </section>;
}
