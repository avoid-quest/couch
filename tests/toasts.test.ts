import { expect, test } from "bun:test";
import { toast, type ToastT } from "sonner";
import { dismiss, notice, queued } from "../src/client/toasts";

// sonner defers a dismissal's notice to a frame; there is no Toaster here to hear it.
globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0) as unknown as number;
globalThis.cancelAnimationFrame ??= (handle) => clearTimeout(handle);

const press = (id: string | number) => {
  const action = toast.getToasts().find((each) => each.id === id)?.action;
  if (action && typeof action === "object" && "onClick" in action) action.onClick({} as never);
};

// Sonner keeps a leaving toast mounted for its exit, then removes whatever its id shows by then.
test("once a kind's toast is leaving, its repeat takes a new id, so that exit can't take it away", () => {
  toast.dismiss();
  const leave = (id: string | number, how: "onAutoClose" | "onDismiss") => {
    const each = toast.getToasts().find((each) => each.id === id) as ToastT | undefined;
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
  const said = notice("Copied");
  dismiss("notice");
  const again = notice("Copied");
  expect(again).not.toBe(said);
  expect(
    toast
      .getToasts()
      .filter((each) => each.id === third || each.id === again)
      .map((each) => each.title),
  ).toEqual(["Queued Film", "Copied"]);
});
