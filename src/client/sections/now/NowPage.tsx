import { useState } from "react";
import { Search } from "lucide-react";
import { HistoryPanel } from "@/components/HistoryPanel";
import { LiveNow } from "./LiveNow";
import { NowPlaying } from "./NowPlaying";
import { useShell } from "@/sections/shell/AppShell";
import { Input } from "@/components/ui/input";

export function NowPage() {
  const shell = useShell();
  const { nativeHost, credentials, state, connected, run, available, tv, browseSection, playHistory, enqueueRadio, gotoSearch, setRemoteOpen } = shell;
  const [nowDraft, setNowDraft] = useState("");
  const onStage = !nativeHost || tv.browsing;
  return (
    <section data-page="Now" className="space-y-6">
      <form role="search" aria-label="Search or paste a link" className="flex items-center gap-3.5 rounded-2xl border bg-card px-4 py-1.5 transition-colors focus-within:border-primary" onSubmit={event => { event.preventDefault(); const query = nowDraft.trim(); if (!query) return; setNowDraft(""); gotoSearch({ query, source: "All" }); }}>
        <Search aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" /><Input id="now-search" aria-label="Search or paste a link" placeholder="Search or paste a link" maxLength={4096} className="h-[54px] border-0 bg-transparent px-0 text-lg shadow-none" value={nowDraft} onChange={event => setNowDraft(event.target.value)} />
      </form>
      <NowPlaying embedded state={state} credentials={credentials} connected={connected} run={run} onBrowse={browseSection} onRemote={nativeHost ? undefined : () => setRemoteOpen(true)} active={onStage} />
      <HistoryPanel origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} onPlay={playHistory} active={onStage} />
      <LiveNow rail limit={8} heading="Live radio" credentials={credentials} connected={connected} canPlay={available} onEnqueue={enqueueRadio} active={onStage} />
    </section>
  );
}
