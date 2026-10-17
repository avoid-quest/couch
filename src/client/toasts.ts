import { toast, type ExternalToast } from "sonner";
import { ApiError } from "./api/client";

// Every toast Couch shows, by kind (docs/design.md, Messages). Each kind fixes its duration and its one action,
// and shows one toast: a repeat updates the one showing. Only this module and the Toaster import sonner.
const brief = 4_000, long = 6_000;

type Kind = "failed" | "undo" | "queued" | "playing-on" | "activity" | "notice" | "tap-to-hear";
/** The Toaster shows the newest two; older ones stay mounted, hidden. */
export const visibleToasts = 2;
// Sonner updates a toast in place, so a repeat keeps its toast's id only while that toast shows: one leaving (timed
// out, dismissed, swiped or acted on) would take the repeat away with it, and one hidden behind newer toasts would
// keep it hidden. Otherwise the repeat takes the next id, and the old toast goes.
const shown = new Map<Kind, { id: string; seq: number; leaving: boolean }>();
let ids = 0;
const showing = (entry: { seq: number }) => [...shown.values()].filter(other => !other.leaving && other.seq > entry.seq).length < visibleToasts;
function show(kind: Kind, text: string, { action, ...options }: Omit<ExternalToast, "id" | "action"> & { action?: { label: string; onClick: () => void } }, as: typeof toast.error = toast) {
  const last = shown.get(kind), current = last && !last.leaving && showing(last) ? last : { id: `${kind}-${++ids}`, seq: ids, leaving: false };
  if (last && last !== current && !last.leaving) { last.leaving = true; toast.dismiss(last.id); }
  shown.set(kind, current);
  const leave = () => { current.leaving = true; };
  return as(text, { ...options, id: current.id, onAutoClose: leave, onDismiss: leave, action: action && { label: action.label, onClick: () => { leave(); action.onClick(); } } });
}
export function dismiss(kind: Kind) {
  const current = shown.get(kind);
  if (current) { current.leaving = true; toast.dismiss(current.id); }
}

/** "Couldn't X." Core's own sentence wins when it sent one; anything else (the network, a timeout) shows `text` and logs the detail. */
export function failed(text: string, reason?: unknown) {
  const said = reason instanceof ApiError && typeof reason.body.error === "string";
  if (reason !== undefined && !said) console.warn(text, reason);
  return show("failed", said ? reason.message : text, { duration: long }, toast.error);
}

// Each Undo offer retires the last, so it takes a new id.
export const dismissUndo = () => dismiss("undo");
export const undoable = (text: string, undo: () => void, duration = long) => {
  dismissUndo();
  return show("undo", text, { duration, action: { label: "Undo", onClick: undo } });
};

export const queued = (title: string | undefined, upNext: () => void) =>
  show("queued", title ? `Queued ${title}` : "Queued", { duration: brief, action: { label: "Up next", onClick: upNext } });
export const playingOn = (name: string) => show("playing-on", `Playing on ${name}`, { duration: brief });
export const activity = (text: string) => show("activity", text, { duration: long });
export const notice = (text: string) => show("notice", text, { duration: long });
export const waitingForTap = (hear: () => void) =>
  show("tap-to-hear", "Sound is waiting for a tap", { duration: Infinity, action: { label: "Tap to hear", onClick: hear } });
