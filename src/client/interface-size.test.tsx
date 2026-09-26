import { setupUiTests, act, renderHook, waitFor } from "./testing/react";
import { expect, spyOn, test } from "bun:test";
import * as core from "@tauri-apps/api/core";
import { saveRemoteInterfaceSize, useRemoteInterfaceSize } from "./interface-size";

setupUiTests();

test("a remote saves its interface size and exposes the selected preference", async () => {
  spyOn(core, "isTauri").mockReturnValue(false);
  const { result } = renderHook(useRemoteInterfaceSize);
  await act(async () => { expect(await saveRemoteInterfaceSize(1.3)).toBe(true); });
  expect(result.current).toBe(1.3);
  expect(localStorage.getItem("couch.remote-interface-size")).toBe("1.3");
  await act(async () => { await saveRemoteInterfaceSize(1); });
  expect(result.current).toBe(1);
});

test("native client reloads a preference changed in another window when it regains focus", async () => {
  let saved = 1;
  spyOn(core, "isTauri").mockReturnValue(true);
  spyOn(core, "invoke").mockImplementation(async () => saved as never);
  const view = renderHook(useRemoteInterfaceSize);
  await waitFor(() => expect(view.result.current).toBe(1));
  saved = 1.3;
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(view.result.current).toBe(1.3);
  view.unmount();
  saved = 1.15;
  const reloaded = renderHook(useRemoteInterfaceSize);
  await waitFor(() => expect(reloaded.result.current).toBe(1.15));
});
