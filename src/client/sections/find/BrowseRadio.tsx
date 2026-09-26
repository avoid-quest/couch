import { offline } from "@/copy";
import { useOptionalSessionGate } from "@/session/session-context";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useCallback, useState } from "react";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { PageHeader } from "@/components/PageHeader";
import { HitList, SourceProblems } from "./SearchPanel";
import { SearchRadioResults } from "./SearchRadioResults";
import type { SearchPlaybackProps, SearchResultSummary } from "./SearchOnlineResults";

type Source = "avoid radio" | "Radio playlists";

export function BrowseRadio({ onBack, ...props }: SearchPlaybackProps & { onBack: () => void }) {
  const name = useOptionalSessionGate()?.state?.installationName;
  const [source, setSource] = useState<Source>("avoid radio");
  const [reported, setReported] = useState<{ source: string; summary: SearchResultSummary } | null>(null);
  const report = useCallback((name: string, summary: SearchResultSummary) => setReported({ source: name, summary }), []);
  const summary = reported?.source === source ? reported.summary : null;
  const hits = summary?.hits?.map(hit => ({ ...hit, meta: hit.meta.split(" · ").filter(part => part !== source).join(" · ") }));
  return <section className="min-w-0 space-y-6" aria-label="Browse radio">
    <PageHeader title="Radio" back={{ label: "Find", onClick: onBack }} />
    <ChoiceGroup label="Radio source" value={source} onValueChange={setSource} options={[{ value: "avoid radio", label: "avoid radio" }, { value: "Radio playlists", label: "Radio playlists" }]} />
    {!props.connected && <p className="text-sm text-muted-foreground" role="status">{offline(name)}</p>}
    {summary?.loading && !summary.hits?.length && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner />Loading stations…</p>}
    {hits?.length ? <HitList hits={hits} label="Radio stations" origin={props.origin} token={props.token} /> : null}
    {summary && <SourceProblems summaries={[[source, summary]]} />}
    {summary && !summary.loading && !summary.error && !summary.hits?.length && <Empty className="py-0"><EmptyHeader><EmptyDescription>{source === "avoid radio" ? "No stations are available right now. Try Radio playlists." : "No radio playlists yet. An admin can add one in Settings → Sources → Radio playlists."}</EmptyDescription></EmptyHeader></Empty>}
    <SearchRadioResults {...props} source={source} query="" onResults={report} />
  </section>;
}
