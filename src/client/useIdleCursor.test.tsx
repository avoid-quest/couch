import { setupUiTests, act, renderHook } from "./testing/react";
import { expect, jest, spyOn, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import { useIdleCursor } from "./useIdleCursor";

setupUiTests();

test("TV cursor hides once the pointer goes idle and returns on movement", async () => {
  const invoke = spyOn(core, "invoke").mockResolvedValue(undefined);
  // Tauri's current-window lookup reads this metadata before invoking the command.
  Object.assign(window, { __TAURI_INTERNALS__: { metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } } } });
  jest.useFakeTimers();
  const view = renderHook(() => useIdleCursor(true));
  try {
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(4_000));
    expect(invoke).toHaveBeenLastCalledWith("plugin:window|set_cursor_visible", { label: "main", value: false });
    await act(async () => window.dispatchEvent(new Event("pointermove")));
    expect(invoke).toHaveBeenLastCalledWith("plugin:window|set_cursor_visible", { label: "main", value: true });
    const shown = invoke.mock.calls.length;
    await act(async () => window.dispatchEvent(new Event("pointermove")));
    expect(invoke).toHaveBeenCalledTimes(shown);
    await act(async () => jest.advanceTimersByTime(4_000));
    expect(invoke).toHaveBeenLastCalledWith("plugin:window|set_cursor_visible", { label: "main", value: false });
    view.unmount();
    expect(invoke).toHaveBeenLastCalledWith("plugin:window|set_cursor_visible", { label: "main", value: true });
  } finally {
    view.unmount();
    jest.useRealTimers();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  }
});
