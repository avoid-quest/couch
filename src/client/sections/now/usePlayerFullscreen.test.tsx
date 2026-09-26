import { setupUiTests, act, renderHook, waitFor } from "@/testing/react";
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import * as nativeContext from "@/session/native-context";
import * as tauriWindow from "@tauri-apps/api/window";
import { toast } from "sonner";
import { usePlayerFullscreen } from "./usePlayerFullscreen";

setupUiTests();

afterEach(() => {
  for (const key of ["fullscreenEnabled", "fullscreenElement", "exitFullscreen"]) Reflect.deleteProperty(document, key);
  Reflect.deleteProperty(document.documentElement, "requestFullscreen");
});

function browserFullscreen() {
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
  const change = (element: Element | null) => {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: element });
    document.dispatchEvent(new Event("fullscreenchange"));
  };
  document.documentElement.requestFullscreen = mock(async () => change(document.documentElement));
  document.exitFullscreen = mock(async () => change(null));
  return change;
}

test("browser fullscreen toggles the document and follows external exits", async () => {
  const change = browserFullscreen();
  const { result } = renderHook(usePlayerFullscreen);
  expect(result.current.supported).toBe(true);
  await act(async () => result.current.toggle());
  expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
  expect(result.current.fullscreen).toBe(true);
  await act(async () => result.current.toggle());
  expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
  expect(result.current.fullscreen).toBe(false);
  await act(async () => change(document.documentElement));
  expect(result.current.fullscreen).toBe(true);
  await act(async () => change(null));
  expect(result.current.fullscreen).toBe(false);
});

test("denied fullscreen reports one error and leaves the control usable", async () => {
  browserFullscreen();
  document.documentElement.requestFullscreen = mock(async () => { throw new Error("Denied"); });
  const error = spyOn(toast, "error").mockImplementation(() => "error");
  const { result } = renderHook(usePlayerFullscreen);
  await act(async () => result.current.toggle());
  expect(result.current.fullscreen).toBe(false);
  expect(result.current.pending).toBe(false);
  expect(error).toHaveBeenCalledTimes(1);
});

test("unsupported browsers and TV kiosk do not offer a fullscreen toggle", () => {
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false });
  const browser = renderHook(usePlayerFullscreen);
  expect(browser.result.current.supported).toBe(false);
  browser.unmount();
  spyOn(nativeContext, "isNativeHost").mockReturnValue(true);
  spyOn(nativeContext, "isTvPresentation").mockReturnValue(true);
  const native = spyOn(tauriWindow, "getCurrentWindow");
  const tv = renderHook(usePlayerFullscreen);
  expect(tv.result.current.supported).toBe(false);
  expect(native).not.toHaveBeenCalled();
});

test("native fullscreen follows window changes and removes its listener", async () => {
  spyOn(nativeContext, "isNativeHost").mockReturnValue(true);
  let fullscreen = true;
  let resized: () => void = () => {};
  const stop = mock(() => {});
  const setFullscreen = mock(async (value: boolean) => { fullscreen = value; });
  spyOn(tauriWindow, "getCurrentWindow").mockReturnValue({
    isFullscreen: async () => fullscreen,
    setFullscreen,
    onResized: async (callback: () => void) => { resized = callback; return stop; },
  } as unknown as tauriWindow.Window);
  const view = renderHook(usePlayerFullscreen);
  await waitFor(() => expect(view.result.current.fullscreen).toBe(true));
  await act(async () => view.result.current.toggle());
  expect(setFullscreen).toHaveBeenCalledWith(false);
  expect(view.result.current.fullscreen).toBe(false);
  fullscreen = true;
  await act(async () => resized());
  expect(view.result.current.fullscreen).toBe(true);
  fullscreen = false;
  await act(async () => resized());
  expect(view.result.current.fullscreen).toBe(false);
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
});
