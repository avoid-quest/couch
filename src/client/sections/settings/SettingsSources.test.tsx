import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
let SettingsSources: typeof import("./SettingsSources")["SettingsSources"];
const render = async (props?: { source?: "metadata" | "streaming-community" }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><SettingsSources connected={false} credentials={null} canManage={false} {...props} /></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};

beforeEach(async () => {
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Event", "MouseEvent", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : (window as unknown as Record<string, unknown>)[key] });
  }
  request = spyOn(globalThis, "fetch");
  ({ SettingsSources } = await import("./SettingsSources"));
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(async () => root.unmount());
  request.mockRestore();
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("source forms mount without legacy version props or an offline read", async () => {
  await render({ source: "metadata" });
  expect(document.querySelector('[aria-label="Movie & show info settings"]')).not.toBeNull();
  await render({ source: "streaming-community" });
  expect(document.querySelector('[aria-label="StreamingCommunity settings"]')).not.toBeNull();
  expect(request).not.toHaveBeenCalled();
});
