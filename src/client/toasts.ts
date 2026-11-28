import { toast, type ExternalToast } from "sonner";
import { ApiError } from "./api/client";

// Every toast Couch shows, by kind (docs/design.md, Messages). Each kind fixes its duration and its one action,
// and shows one toast: a repeat updates the one showing. Only this module and the Toaster import sonner.
const brief = 4_000,
  long = 6_000;

type Kind = "failed" | "undo" | "queued" | "playing-on" | "notice" | "tap-to-hear" | "sharing";
/** The Toaster shows the newest two; older ones stay mounted, hidden. */
export const visibleToasts = 2;
// Sonner updates a toast in place, so a repeat keeps its toast's id only while that toast shows: one leaving (timed
// out, dismissed, swiped or acted on) would take the repeat away with it, and one hidden behind newer toasts would
// keep it hidden. Otherwise the repeat takes the next id, and the old toast goes.
const shown = new Map<Kind, { id: string; seq: number; leaving: boolean }>();
let ids = 0;
let playingOnDevice: string | undefined;
const showing = (entry: { seq: number }) =>
  [...shown.values()].filter((other) => !other.leaving && other.seq > entry.seq).length <
  visibleToasts;
function show(
  kind: Kind,
  text: string,
  {
    action,
    ...options
  }: Omit<ExternalToast, "id" | "action"> & { action?: { label: string; onClick: () => void } },
  as: typeof toast.error = toast,
) {
  const last = shown.get(kind),
    current =
      last && !last.leaving && showing(last)
        ? last
        : { id: `${kind}-${++ids}`, seq: ids, leaving: false };
  if (last && last !== current && !last.leaving) {
    last.leaving = true;
    toast.dismiss(last.id);
  }
  shown.set(kind, current);
  const leave = () => {
    current.leaving = true;
  };
  return as(text, {
    ...options,
    id: current.id,
    onAutoClose: leave,
    onDismiss: leave,
    action: action && {
      label: action.label,
      onClick: () => {
        leave();
        action.onClick();
      },
    },
  });
}
export function dismiss(kind: Kind) {
  const current = shown.get(kind);
  if (current) {
    current.leaving = true;
    toast.dismiss(current.id);
  }
}

/** Feedback and actions for the previous item or controlled device no longer apply. */
export function dismissPlaybackFeedback(controlling?: string) {
  dismiss("queued");
  dismiss("undo");
  // A command can finish before its snapshot. Its destination confirmation is still current there.
  if (playingOnDevice !== controlling) dismiss("playing-on");
}
export function dismissAll() {
  for (const kind of shown.keys()) dismiss(kind);
}

/** "Couldn't X." Core's own sentence wins when it sent one; anything else (the network, a timeout) shows `text` and logs the detail. */
export function failed(text: string, reason?: unknown) {
  const said = reason instanceof ApiError && typeof reason.body.error === "string";
  if (reason !== undefined && !said) console.warn(text, reason);
  return show("failed", said ? reason.message : text, { duration: long }, toast.error);
}

/** Sonner's own phone breakpoint: there every toast sits at the bottom, by the thumb (sonner.tsx). */
export const phoneQuery = "(max-width: 600px)";
/** Where a control is, or the focused one: none for the page itself. */
export function controlBox(control = globalThis.document?.activeElement) {
  return control && control !== document.body ? control.getBoundingClientRect() : undefined;
}
/**
 * The toast corner nearest a control, so what it caused shows beside it as far as sonner's six places allow: the top
 * or bottom half, then the left, middle or right third. Phones keep the Toaster's own place.
 */
function nearest(box = controlBox()): ExternalToast["position"] {
  if (!box?.width || window.matchMedia(phoneQuery).matches) return undefined;
  const x = (box.left + box.width / 2) / window.innerWidth,
    y = (box.top + box.height / 2) / window.innerHeight;
  return `${y < 0.5 ? "top" : "bottom"}-${x < 1 / 3 ? "left" : x > 2 / 3 ? "right" : "center"}`;
}

// Each Undo offer retires the last, so it takes a new id. It shows by the control that caused it: where it was when
// pressed, else the one holding focus, where a closed menu returns it.
export const dismissUndo = () => dismiss("undo");
export const undoable = (text: string, undo: () => void, duration = long, control?: DOMRect) => {
  dismissUndo();
  return show("undo", text, {
    duration,
    position: nearest(control),
    action: { label: "Undo", onClick: undo },
  });
};

// Beside the control that queued it, as Undo is.
export const queued = (title: string | undefined, upNext: () => void) =>
  show("queued", title ? `Queued ${title}` : "Queued", {
    duration: brief,
    position: nearest(),
    action: { label: "Up next", onClick: upNext },
  });
export const playingOn = (name: string, deviceId: string) => {
  playingOnDevice = deviceId;
  return show("playing-on", `Playing on ${name}`, { duration: brief });
};
export const notice = (text: string) => show("notice", text, { duration: long });
/**
 * Once the last device stops watching, the capture still runs: say so once, with Stop sharing. Like every sharing
 * control it stays this device's own; sonner takes no data attributes, so navigation.ts reads its class instead.
 */
export const stillSharing = (title: string, stop: () => void, live = false) =>
  show("sharing", `Still sharing ${title}, ${live ? "with no listeners" : "on no screens"}`, {
    duration: long,
    className: "tv-local-only",
    action: { label: "Stop sharing", onClick: stop },
  });
export const waitingForTap = (hear: () => void) =>
  show("tap-to-hear", "Sound is waiting for a tap", {
    duration: Infinity,
    action: { label: "Tap to hear", onClick: hear },
  });
