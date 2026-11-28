import { useSyncExternalStore, type CSSProperties } from "react";
import { toast, type ExternalToast } from "sonner";
import { ApiError } from "./api/client";

// Every toast Couch shows, by kind (docs/design.md, Messages). Each kind fixes its duration and its one action,
// and shows one toast: a repeat updates the one showing. Only this module and the Toaster import sonner.
const brief = 4_000,
  long = 6_000;
/** How long Undo stays: Core keeps a stopped Playback this long (a removed entry only six seconds). */
export const undoTime = 10_000;

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

// Each Undo offer retires the last, so it takes a new id, and its bar drains over its time (index.css).
export const dismissUndo = () => dismiss("undo");
export const undoable = (text: string, undo: () => void, duration = undoTime) => {
  dismissUndo();
  return show("undo", text, {
    duration,
    className: "message-drains",
    style: { "--message-time": `${duration}ms` } as CSSProperties,
    action: { label: "Undo", onClick: undo },
  });
};

export const queued = (title: string | undefined, upNext: () => void) =>
  confirmations.read() &&
  show("queued", title ? `Queued ${title}` : "Queued", {
    duration: brief,
    action: { label: "Up next", onClick: upNext },
  });
export const playingOn = (name: string, deviceId: string) => {
  playingOnDevice = deviceId;
  return confirmations.read() && show("playing-on", `Playing on ${name}`, { duration: brief });
};
export const notice = (text: string) => show("notice", text, { duration: long });
/** A notice that only confirms what the person just did, which they may turn off. */
export const confirmed = (text: string) => confirmations.read() && notice(text);
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

// Where messages appear and whether confirmations show, saved per device (This device → General).
function storedChoice<T extends string>(key: string, choices: readonly T[]) {
  const listeners = new Set<() => void>();
  const read = (): T => {
    try {
      const value = localStorage.getItem(key);
      return choices.find((choice) => choice === value) ?? choices[0]!;
    } catch {
      return choices[0]!;
    }
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", listener);
    };
  };
  const save = (value: T) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      return;
    }
    listeners.forEach((listener) => listener());
  };
  const use = () => useSyncExternalStore(subscribe, read, () => choices[0]!);
  return { read, save, use };
}
export const messagePlace = storedChoice("couch.messages-place", ["bottom", "top"] as const);
const confirmationsChoice = storedChoice("couch.messages-confirmations", ["shown", "hidden"]);
export const confirmations = {
  read: () => confirmationsChoice.read() === "shown",
  use: () => confirmationsChoice.use() === "shown",
  save: (shown: boolean) => confirmationsChoice.save(shown ? "shown" : "hidden"),
};
