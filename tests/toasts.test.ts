import { expect, spyOn, test } from "bun:test";
import { toast } from "sonner";
import { ApiError } from "../src/client/api/client";
import { activity, dismiss, failed, notice, playingOn, queued, undoable, waitingForTap } from "../src/client/toasts";

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

test("each kind fixes its id, duration and one action, so a repeat replaces the one showing", () => {
  toast.dismiss();
  playingOn("Kitchen"); playingOn("Studio");
  activity("Phone paused"); activity("Phone resumed");
  notice("Skipped 2 channels with a repeated tvg-id.");
  let up = 0;
  queued("Film", () => up++); queued(undefined, () => up++);
  waitingForTap(() => {});
  expect(shown()).toEqual([
    { id: "playing-on", title: "Playing on Studio", type: undefined, duration: 4_000, action: undefined },
    { id: "activity", title: "Phone resumed", type: undefined, duration: 6_000, action: undefined },
    { id: "notice", title: "Skipped 2 channels with a repeated tvg-id.", type: undefined, duration: 6_000, action: undefined },
    { id: "queued", title: "Queued", type: undefined, duration: 4_000, action: "Up next" },
    { id: "tap-to-hear", title: "Sound is waiting for a tap", type: undefined, duration: Infinity, action: "Tap to hear" },
  ]);
  press("queued");
  expect(up).toBe(1);
  dismiss("tap-to-hear"); dismiss("queued");
  expect(shown().map(each => each.id)).toEqual(["playing-on", "activity", "notice"]);
});

test("a failure shows Core's own sentence, else the Couch one, and logs what it hid", () => {
  toast.dismiss();
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  failed("Couldn't save Film.", new ApiError("For later can hold 500 items.", 409, { error: "For later can hold 500 items." }));
  expect(shown()).toEqual([{ id: "failed", title: "For later can hold 500 items.", type: "error", duration: 6_000, action: undefined }]);
  expect(warn).not.toHaveBeenCalled();
  const offline = new TypeError("Failed to fetch");
  failed("Couldn't save Film.", offline);
  failed("Couldn't save Film.", new ApiError("Request failed: /api/for-later", 405));
  expect(shown()).toEqual([{ id: "failed", title: "Couldn't save Film.", type: "error", duration: 6_000, action: undefined }]);
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
