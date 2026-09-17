import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useState, type ReactNode } from "react";
import { Check, Eye, EyeOff, PencilLine, Search } from "lucide-react";
import { HistoryPanel } from "@/components/HistoryPanel";
import { SortableRow, useDndSensors } from "@/lib/dnd";
import { moveNowSection, nowSectionLabels, readNowSections, saveNowSections, type NowSectionId } from "@/now-sections";
import { LiveNow } from "./LiveNow";
import { NowPlaying } from "./NowPlaying";
import { useShell } from "@/sections/shell/AppShell";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

export function NowPage() {
  const shell = useShell();
  const { nativeHost, credentials, state, connected, run, available, tv, browseSection, playHistory, enqueueRadio, gotoSearch, setRemoteOpen } = shell;
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
          <div className="flex items-center gap-2">
            <form role="search" aria-label="Search or paste a link" className="min-w-0 flex-1" onSubmit={event => { event.preventDefault(); const query = nowDraft.trim(); if (!query) return; setNowDraft(""); gotoSearch({ query, source: "All" }); }}>
              <InputGroup className="rounded-2xl border bg-card py-1 shadow-[0_1px_0_rgb(0_0_0/0.2)] focus-within:border-primary">
                <InputGroupAddon align="inline-start"><Search aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" /></InputGroupAddon>
                <InputGroupInput id="now-search" aria-label="Search or paste a link" placeholder="Search or paste a link" maxLength={4096} value={nowDraft} onChange={event => setNowDraft(event.target.value)} />
              </InputGroup>
            </form>
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
        </section>
      </SortableContext>
    </DndContext>
  );
}
