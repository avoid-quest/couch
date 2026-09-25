import { KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { GripVertical } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "@/components/ui/button";

// One sensor set for every sortable surface: pointer and touch need a drag
// distance or hold so clicks pass through, and the keyboard sensor keeps
// reordering usable from the TV remote's directional keys.
export function useDndSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

// The reorder gesture at handler level: both ids must belong to the list and
// differ, otherwise nothing moved and the caller persists nothing.
export function reorderedIds<T>(items: T[], id: (item: T) => string, activeId: string, overId: string): T[] | null {
  const from = items.findIndex(item => id(item) === activeId), to = items.findIndex(item => id(item) === overId);
  return from < 0 || to < 0 || from === to ? null : arrayMove(items, from, to);
}

// Optimistic display order: applied while it names every loaded item, so a
// half-known order (an item added elsewhere) falls back to the server order.
export function applyIdOrder<T>(items: T[], order: string[] | undefined, id: (item: T) => string): T[] {
  if (!order) return items;
  const byId = new Map(items.map(item => [id(item), item] as const));
  const ordered = order.map(key => byId.get(key)).filter((item): item is T => item !== undefined);
  return ordered.length === items.length ? ordered : items;
}

export type RowDrag = {
  setNodeRef: (node: HTMLElement | null) => void;
  style: CSSProperties;
  handle: ReactNode;
};

// Render-prop wrapper so each surface keeps its own row markup and only adds
// the ref, transform style and a keyboard-reachable drag handle.
export function SortableRow({ id, label, children }: { id: string; label: string; children: (drag: RowDrag) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return <>{children({
    setNodeRef,
    style: { transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition, zIndex: isDragging ? 20 : undefined },
    handle: <Button variant="ghost" size="icon" className="cursor-grab touch-none text-muted-foreground hover:text-foreground" aria-label={label} {...attributes} {...listeners}><GripVertical aria-hidden="true" /></Button>,
  })}</>;
}
