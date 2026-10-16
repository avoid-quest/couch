import { toast } from "sonner";
import { ApiError } from "./api/client";

// Every toast Couch shows, by kind (docs/design.md, Messages). Each kind fixes its id, so a repeat replaces the
// one showing, its duration and its one action. Only this module and the Toaster import sonner.
const brief = 4_000, long = 6_000;

/** "Couldn't X." Core's own sentence wins when it sent one; anything else (the network, a timeout) shows `text` and logs the detail. */
export function failed(text: string, reason?: unknown) {
  const said = reason instanceof ApiError && typeof reason.body.error === "string";
  if (reason !== undefined && !said) console.warn(text, reason);
  return toast.error(said ? reason.message : text, { id: "failed", duration: long });
}

// Each offer takes a new id and retires the last: re-showing an id still leaving would leave with it.
let offer = 0;
export const dismissUndo = () => toast.dismiss(`undo-${offer}`);
export const undoable = (text: string, undo: () => void, duration = long) => {
  dismissUndo();
  return toast(text, { id: `undo-${++offer}`, duration, action: { label: "Undo", onClick: undo } });
};

export const queued = (title: string | undefined, upNext: () => void) =>
  toast(title ? `Queued ${title}` : "Queued", { id: "queued", duration: brief, action: { label: "Up next", onClick: upNext } });
export const playingOn = (name: string) => toast(`Playing on ${name}`, { id: "playing-on", duration: brief });
export const activity = (text: string) => toast(text, { id: "activity", duration: long });
export const notice = (text: string) => toast(text, { id: "notice", duration: long });
export const waitingForTap = (hear: () => void) =>
  toast("Sound is waiting for a tap", { id: "tap-to-hear", duration: Infinity, action: { label: "Tap to hear", onClick: hear } });
export const dismiss = (id: "queued" | "activity" | "tap-to-hear") => toast.dismiss(id);
