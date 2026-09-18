import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { TvAppearance } from "../shared/appearance";
let root: Root, window: Window;
let useInterfaceSize: typeof import("./interface-size")["useInterfaceSize"];
let saveRemoteInterfaceSize: typeof import("./interface-size")["saveRemoteInterfaceSize"];
const originals = new Map<string, PropertyDescriptor | undefined>();
beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "localStorage", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key) });
  }
  const { createRoot } = await import("react-dom/client");
  ({ useInterfaceSize, saveRemoteInterfaceSize } = await import("./interface-size"));
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount()); window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});
function Size({ native, appearance }: { native: boolean; appearance: TvAppearance }) { useInterfaceSize(native, appearance); return null; }

test("saved Largest applies the same scale on the TV and on remotes", async () => {
  const appearance: TvAppearance = { size: 1.3, confirmedSize: 1.3, preview: null };
  let measurements = 0;
  window.addEventListener("couch-interface-size-applied", () => measurements++);
  await act(async () => root.render(<Size native appearance={appearance} />));
  expect(document.documentElement.style.getPropertyValue("--interface-scale")).toBe("1.3");
  expect(measurements).toBe(1);
  await act(async () => { saveRemoteInterfaceSize(1.3); root.render(<Size native={false} appearance={appearance} />); });
  expect(document.documentElement.style.getPropertyValue("--interface-scale")).toBe("1.3");
  // The same choice on TV and remote applies one scale: no redundant event.
  expect(measurements).toBe(1);
});

test("expired TV previews restore the confirmed viewing scale and Default remains a reachable reset", async () => {
  await act(async () => root.render(<Size native appearance={{ size: 1.3, confirmedSize: 1.15, preview: { id: "expired", expiresAt: Date.now() - 1 } }} />));
  expect(document.documentElement.style.getPropertyValue("--interface-scale")).toBe("1.15");
  await act(async () => root.render(<Size native appearance={{ size: 1, confirmedSize: 1, preview: null }} />));
  expect(document.documentElement.style.getPropertyValue("--interface-scale")).toBe("1");
});
