import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useState, type ReactNode } from "react";
import { Check, Eye, EyeOff, PencilLine } from "lucide-react";
import { HistoryPanel } from "@/components/HistoryPanel";
import { AddMediaDialog } from "./AddMediaDialog";
import { OpenFileButton } from "./OpenFileButton";
import { SortableRow, useDndSensors } from "@/lib/dnd";
import { moveNowSection, nowSectionLabels, readNowSections, saveNowSections, type NowSectionId } from "@/now-sections";
import { LiveNow } from "./LiveNow";
import { NowPlaying } from "./NowPlaying";
import { useShell } from "@/sections/shell/AppShell";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { SearchBar } from "@/components/SearchBar";
import { SessionBar } from "@/components/SessionBar";

export function NowPage() {
  const shell = useShell();
  const { localHost, tvPresentation, credentials, state, connected, run, available, tv, browseSection, playHistory, enqueueRadio, gotoSearch, setRemoteOpen, recentRadio, videoQualityPreference } = shell;
  const [nowDraft, setNowDraft] = useState("");
  const [layout, setLayout] = useState<ReturnType<typeof readNowSections>>(readNowSections);
  const { order, hidden } = layout;
  const [editing, setEditing] = useState(false);
  const sensors = useDndSensors();
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const next = moveNowSection(order, String(active.id), String(over.id));
    if (next) { setLayout({ ...layout, order: next }); saveNowSections({ ...layout, order: next }); }
  };
  const toggleSection = (id: NowSectionId) => {
    const hiddenNext = hidden.includes(id) ? hidden.filter(entry => entry !== id) : [...hidden, id];
    const next = { order, hidden: hiddenNext };
    setLayout(next); saveNowSections(next);
  };
  const onStage = !tvPresentation || tv.browsing;
  const sections: Record<NowSectionId, ReactNode> = {
    playing: <NowPlaying embedded part="current" state={state} credentials={credentials} connected={connected} run={run} onBrowse={browseSection} active={onStage} />,
    queue: <NowPlaying embedded part="next" state={state} credentials={credentials} connected={connected} run={run} active={onStage} />,
    history: <HistoryPanel origin={credentials.origin} token={credentials.token} connected={connected} canPlay={available} onPlay={playHistory} active={onStage} stations={recentRadio} onRadio={station => enqueueRadio(station, true)} />,
    radio: <LiveNow rail heading="Live radio" credentials={credentials} connected={connected} canPlay={available} onEnqueue={enqueueRadio} active={onStage} />,
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <section data-page="Now" className="space-y-6">
          <div className="flex items-center gap-2">
            <SearchBar id="now-search" className="min-w-0 flex-1" value={nowDraft} onValueChange={setNowDraft} onSubmit={() => { const query = nowDraft.trim(); if (!query) return; setNowDraft(""); gotoSearch({ query, source: "All" }); }} />
            {localHost && !tvPresentation && <OpenFileButton connected={connected} run={run} />}
            <AddMediaDialog credentials={credentials} connected={connected} defaultQuality={videoQualityPreference.quality} run={run} />
            <Button variant="ghost" size="icon" className="hidden lg:inline-flex" aria-label={editing ? "Done customizing" : "Customize this page"} aria-pressed={editing} onClick={() => setEditing(value => !value)}>
              {editing ? <Check aria-hidden="true" /> : <PencilLine aria-hidden="true" />}
            </Button>
          </div>
          <div className="flex justify-end lg:hidden">
            <Button variant="ghost" size="icon" aria-label={editing ? "Done customizing" : "Customize this page"} aria-pressed={editing} onClick={() => setEditing(value => !value)}>
              {editing ? <Check aria-hidden="true" /> : <PencilLine aria-hidden="true" />}
            </Button>
          </div>
          {order.map(id => {
            const isHidden = hidden.includes(id);
            if (isHidden && !editing) return null;
            return <SortableRow key={id} id={id} editing={editing} label={`Reorder the ${nowSectionLabels[id]} section`}>
              {drag => isHidden
                ? <div className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-dashed p-4 text-muted-foreground">
                    <span>{nowSectionLabels[id]}</span>
                    <Button variant="ghost" aria-label={`Show ${nowSectionLabels[id]}`} onClick={() => toggleSection(id)}><Eye aria-hidden="true" />Show</Button>
                  </div>
                : <div ref={drag.setNodeRef} style={drag.style} className="relative">
                    {sections[id]}
                    {editing && <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-xl bg-card/80 p-1 backdrop-blur">
                      <Button variant="ghost" size="icon" aria-label={`Hide ${nowSectionLabels[id]}`} onClick={() => toggleSection(id)}><EyeOff aria-hidden="true" /></Button>
                      {drag.handle}
                    </div>}
                  </div>}
            </SortableRow>;
          })}
          {/* A customized Now page can hide its Now playing section. This bar is
              the TV's remaining transport route while browsing that page. */}
          {tvPresentation && tv.browsing && hidden.includes("playing") && <SessionBar state={state} credentials={credentials} connected={connected} run={run} onOpen={() => tv.dismissLayer()} />}
        </section>
      </SortableContext>
    </DndContext>
  );
}
