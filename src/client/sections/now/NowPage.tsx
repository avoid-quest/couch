import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { HistoryPanel } from "@/components/HistoryPanel";
import { SortableRow, useDndSensors } from "@/lib/dnd";
import { moveNowSection, nowSectionLabels, readNowSectionOrder, saveNowSectionOrder, type NowSectionId } from "@/now-sections";
import { LiveNow } from "./LiveNow";
import { NowPlaying } from "./NowPlaying";
import { useShell } from "@/sections/shell/AppShell";
import { Input } from "@/components/ui/input";

export function NowPage() {
  const shell = useShell();
  const { nativeHost, credentials, state, connected, run, available, tv, browseSection, playHistory, enqueueRadio, gotoSearch, setRemoteOpen } = shell;
  const [nowDraft, setNowDraft] = useState("");
  const [order, setOrder] = useState<NowSectionId[]>(readNowSectionOrder);
  const sensors = useDndSensors();
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const next = moveNowSection(order, String(active.id), String(over.id));
    if (next) { setOrder(next); saveNowSectionOrder(next); }
  };
  const onStage = !nativeHost || tv.browsing;
  const sections: Record<NowSectionId, ReactNode> = {
    playing: <NowPlaying embedded state={state} credentials={credentials} connected={connected} run={run} onBrowse={browseSection} onRemote={nativeHost ? undefined : () => setRemoteOpen(true)} active={onStage} />,
    history: <HistoryPanel origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} onPlay={playHistory} active={onStage} />,
    radio: <LiveNow rail limit={8} heading="Live radio" credentials={credentials} connected={connected} canPlay={available} onEnqueue={enqueueRadio} active={onStage} />,
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <section data-page="Now" className="space-y-6">
          <form role="search" aria-label="Search or paste a link" className="flex items-center gap-3.5 rounded-2xl border bg-card px-4 py-1.5 transition-colors focus-within:border-primary" onSubmit={event => { event.preventDefault(); const query = nowDraft.trim(); if (!query) return; setNowDraft(""); gotoSearch({ query, source: "All" }); }}>
            <Search aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" /><Input id="now-search" aria-label="Search or paste a link" placeholder="Search or paste a link" maxLength={4096} className="h-[54px] border-0 bg-transparent px-0 text-lg shadow-none" value={nowDraft} onChange={event => setNowDraft(event.target.value)} />
          </form>
          {order.map(id => <SortableRow key={id} id={id} label={`Reorder the ${nowSectionLabels[id]} section`} className="absolute right-2 top-2 z-10">
            {drag => <div ref={drag.setNodeRef} style={drag.style} className="relative">{sections[id]}{drag.handle}</div>}
          </SortableRow>)}
        </section>
      </SortableContext>
    </DndContext>
  );
}
