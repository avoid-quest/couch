import { expect, spyOn, test } from "bun:test";
import { toast, type ToastT } from "sonner";
import { ApiError } from "../src/client/api/client";
import { dismiss, dismissAll, dismissPlaybackFeedback, failed, notice, playingOn, queued, stillSharing, undoable, waitingForTap } from "../src/client/toasts";

// sonner defers a dismissal's notice to a frame; there is no Toaster here to hear it.
globalThis.requestAnimationFrame ??= callback => setTimeout(callback, 0) as unknown as number;
globalThis.cancelAnimationFrame ??= handle => clearTimeout(handle);

// What sonner would show: the active toasts, newest last.
const shown = () => toast.getToasts().map(({ id, title, type, duration, action }) => ({
  id, title, type, duration, action: action && typeof action === "object" && "label" in action ? action.label : undefined,
}));
const press = (id: string | number) => {
  const action = toast.getToasts().find(each => each.id === id)?.action;
  if (action && typeof action === "object" && "onClick" in action) action.onClick({} as never);
};

test("Live's empty-audience notice names listeners and keeps Stop sharing", () => {
  dismissAll();
  let stopped = false;
  const id = stillSharing("Studio · Live audio", () => { stopped = true; }, true);
  expect(shown()).toEqual([{ id, title: "Still sharing Studio · Live audio, with no listeners", type: undefined, duration: 6_000, action: "Stop sharing" }]);
  press(id);
  expect(stopped).toBe(true);
  dismissAll();
});

test("each kind fixes its duration and one action, and a repeat replaces the one showing", () => {
  toast.dismiss();
  const playing = playingOn("Kitchen", "kitchen");
  expect(playingOn("Studio", "studio")).toBe(playing);
  notice("Skipped 2 channels with a repeated tvg-id.");
  let up = 0;
  const queue = queued("Film", () => up++);
  expect(queued(undefined, () => up++)).toBe(queue);
  waitingForTap(() => {});
  expect(shown().map(({ id: _, ...each }) => each)).toEqual([
    { title: "Playing on Studio", type: undefined, duration: 4_000, action: undefined },
    { title: "Skipped 2 channels with a repeated tvg-id.", type: undefined, duration: 6_000, action: undefined },
    { title: "Queued", type: undefined, duration: 4_000, action: "Up next" },
    { title: "Sound is waiting for a tap", type: undefined, duration: Infinity, action: "Tap to hear" },
  ]);
  press(queue);
  expect(up).toBe(1);
  dismiss("tap-to-hear"); dismiss("queued");
  expect(shown().map(each => each.title)).toEqual(["Playing on Studio", "Skipped 2 channels with a repeated tvg-id."]);
});

// Sonner keeps a leaving toast mounted for its exit, then removes whatever its id shows by then.
test("once a kind's toast is leaving, its repeat takes a new id, so that exit can't take it away", () => {
  toast.dismiss();
  const leave = (id: string | number, how: "onAutoClose" | "onDismiss") => {
    const each = toast.getToasts().find(each => each.id === id) as ToastT | undefined;
    each?.[how]?.(each);
  };
  const first = queued("Film", () => {});
  leave(first, "onAutoClose");
  const second = queued("Film", () => {});
  expect(second).not.toBe(first);
  leave(first, "onDismiss");
  expect(queued("Show", () => {})).toBe(second);
  press(second);
  const third = queued("Film", () => {});
  expect(third).not.toBe(second);
  const sound = waitingForTap(() => {});
  dismiss("tap-to-hear");
  const again = waitingForTap(() => {});
  expect(again).not.toBe(sound);
  expect(shown().filter(each => each.id === third || each.id === again).map(each => each.title)).toEqual(["Queued Film", "Sound is waiting for a tap"]);
});

test("a repeat behind two newer toasts takes a new id and shows, and its hidden toast goes", () => {
  toast.dismiss();
  const first = failed("Couldn't play Film.");
  playingOn("Kitchen", "kitchen");
  notice("Skipped 2 channels with a repeated tvg-id.");
  const again = failed("Couldn't play Film again.");
  expect(again).not.toBe(first);
  expect(shown().map(each => each.title)).toEqual(["Playing on Kitchen", "Skipped 2 channels with a repeated tvg-id.", "Couldn't play Film again."]);
  toast.dismiss();
});

test("a playback change retires old actions, preserving errors and audio recovery", () => {
  dismissAll();
  queued("Film", () => {});
  playingOn("Kitchen", "kitchen");
  undoable("Stopped.", () => {});
  failed("Couldn't save Film.");
  waitingForTap(() => {});
  dismissPlaybackFeedback();
  expect(shown().map(each => each.title)).toEqual(["Couldn't save Film.", "Sound is waiting for a tap"]);
  dismissAll();
  expect(shown()).toEqual([]);
  const again = queued("Next film", () => {});
  expect(shown()).toEqual([{ id: again, title: "Queued Next film", type: undefined, duration: 4_000, action: "Up next" }]);
  dismissAll();
});

test("a delayed snapshot preserves Playing on for its destination and switching away retires it", () => {
  dismissAll();
  playingOn("Kitchen", "kitchen");
  dismissPlaybackFeedback("kitchen");
  expect(shown().map(each => each.title)).toEqual(["Playing on Kitchen"]);
  dismissPlaybackFeedback("studio");
  expect(shown()).toEqual([]);
});

test("a failure shows Core's own sentence, else the Couch one, and logs what it hid", () => {
  toast.dismiss();
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const id = failed("Couldn't save Film.", new ApiError("For later can hold 500 items.", 409, { error: "For later can hold 500 items." }));
  expect(shown()).toEqual([{ id, title: "For later can hold 500 items.", type: "error", duration: 6_000, action: undefined }]);
  expect(warn).not.toHaveBeenCalled();
  const offline = new TypeError("Failed to fetch");
  failed("Couldn't save Film.", offline);
  failed("Couldn't save Film.", new ApiError("Request failed: /api/for-later", 405));
  expect(shown()).toEqual([{ id, title: "Couldn't save Film.", type: "error", duration: 6_000, action: undefined }]);
  expect(warn).toHaveBeenCalledWith("Couldn't save Film.", offline);
  warn.mockRestore();
});

test("Undo offers one at a time, each under a new id, and runs its own undo", () => {
  toast.dismiss();
  const undone: string[] = [];
  const first = undoable("Removed Film.", () => undone.push("film"));
  const second = undoable("Stopped.", () => undone.push("stop"), 2_500);
  expect(first).not.toBe(second);
  expect(shown()).toEqual([{ id: second, title: "Stopped.", type: undefined, duration: 2_500, action: "Undo" }]);
  press(second);
  expect(undone).toEqual(["stop"]);
  const third = undoable("Removed Film.", () => {});
  expect(shown()).toEqual([{ id: third, title: "Removed Film.", type: undefined, duration: 6_000, action: "Undo" }]);
});
