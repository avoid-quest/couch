import { useState } from "react";
import { Search } from "lucide-react";
import { HistoryPanel } from "../../HistoryPanel";
import { LiveNow } from "../../LiveNow";
import { NowPlaying } from "../../NowPlaying";
import { useShell } from "../../shell";
import { Input } from "@/components/ui/input";

export function NowPage() {
  const shell = useShell();
  const { nativeHost, credentials, state, connected, run, available, tv, browseSection, playHistory, enqueueRadio, gotoSearch, setRemoteOpen } = shell;
  const [nowDraft, setNowDraft] = useState("");
  const onStage = !nativeHost || tv.browsing;
  return (
    <section data-page="Now" className="space-y-6">
      <form role="search" aria-label="Search or paste a link" className="now-search" onSubmit={event => { event.preventDefault(); const query = nowDraft.trim(); if (!query) return; setNowDraft(""); gotoSearch({ query, source: "All" }); }}>
        <Search aria-hidden="true" /><Input id="now-search" aria-label="Search or paste a link" placeholder="Search or paste a link" maxLength={4096} value={nowDraft} onChange={event => setNowDraft(event.target.value)} />
      </form>
      <NowPlaying embedded state={state} credentials={credentials} connected={connected} run={run} onBrowse={browseSection} onRemote={nativeHost ? undefined : () => setRemoteOpen(true)} active={onStage} />
      <HistoryPanel origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.libraryVersion ?? 0} onPlay={playHistory} active={onStage} />
      <LiveNow rail limit={8} heading="Live radio" origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} version={state?.radioVersion ?? 0} onEnqueue={enqueueRadio} active={onStage} />
    </section>
  );
}
