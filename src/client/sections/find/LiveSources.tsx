import { useState } from "react";
import { ContentBreadcrumb } from "@/components/ContentBreadcrumb";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useSessionGate } from "@/session/session-context";
import { useShell } from "@/sections/shell/AppShell";
import { offline } from "@/copy";
import { HitList } from "./SearchPanel";
import { useLiveSourceHits } from "./useLiveSourceHits";

export function LiveSources() {
  const { state, connected } = useSessionGate();
  const { openSources } = useShell();
  const [filter, setFilter] = useState("");
  const publications = state?.liveSources ?? [];
  const matches = useLiveSourceHits(filter);
  return <section aria-label="Browse device inputs" className="min-w-0 space-y-6">
    <ContentBreadcrumb title="Device inputs" />
    <PageHeader title="Device inputs" className="mb-0" />
    {!connected && <p role="status" className="text-sm text-muted-foreground">{offline(state?.installationName)}</p>}
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p className="text-sm text-muted-foreground" role="status">{publications.length} live {publications.length === 1 ? "input" : "inputs"}</p>
      <div className="flex flex-wrap items-center gap-4">
        {!!publications.length && <Input type="search" aria-label="Filter inputs" placeholder="Filter" className="h-8 w-32 border-0 bg-transparent px-0 shadow-none dark:bg-transparent sm:w-40" value={filter} onChange={event => setFilter(event.target.value)} />}
        <Button variant="outline" disabled={!connected} onClick={() => openSources("device-inputs")}>Add source</Button>
      </div>
    </div>
    <HitList hits={matches} label="Device inputs" timeline={false} />
    {!matches.length && <Empty className="py-0"><EmptyHeader><EmptyDescription>{filter ? "No inputs match. Try another name or clear the filter." : "No inputs are sharing yet. Add a source on the device whose screen or sound you want to play."}</EmptyDescription></EmptyHeader></Empty>}
  </section>;
}
