import { useCallback, useState } from "react";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { PageHeader } from "@/components/PageHeader";
import { HitList, SourceProblems } from "./SearchPanel";
import { SearchRadioResults } from "./SearchRadioResults";
import type { SearchPlaybackProps, SearchResultSummary } from "./SearchOnlineResults";

type Source = "avoid radio" | "Radio playlists";

export function BrowseRadio({ onBack, ...props }: SearchPlaybackProps & { onBack: () => void }) {
  const [source, setSource] = useState<Source>("avoid radio");
  const [reported, setReported] = useState<{ source: string; summary: SearchResultSummary } | null>(null);
  const report = useCallback((name: string, summary: SearchResultSummary) => setReported({ source: name, summary }), []);
  const summary = reported?.source === source ? reported.summary : null;
  const hits = summary?.hits?.map(hit => ({ ...hit, meta: hit.meta.split(" · ").filter(part => part !== source).join(" · ") }));
  return <section className="min-w-0 space-y-6" aria-label="Browse radio">
    <PageHeader title="Radio" back={{ label: "Find", onClick: onBack }} />
    <ChoiceGroup label="Radio source" value={source} onValueChange={setSource} options={[{ value: "avoid radio", label: "avoid radio" }, { value: "Radio playlists", label: "Radio playlists" }]} />
    {!props.connected && <p className="text-sm text-muted-foreground" role="status">Reconnect to browse radio.</p>}
    {summary?.loading && !summary.hits?.length && <p className="text-sm text-muted-foreground" role="status">Loading stations…</p>}
    {hits?.length ? <HitList hits={hits} label="Radio stations" origin={props.origin} token={props.token} /> : null}
    {summary && <SourceProblems summaries={[[source, summary]]} />}
    {summary && !summary.loading && !summary.error && !summary.hits?.length && <p className="text-sm text-muted-foreground">{source === "avoid radio" ? "No stations are available right now." : "No radio playlists yet. An admin can add one in Settings."}</p>}
    <SearchRadioResults {...props} source={source} query="" onResults={report} />
  </section>;
}
