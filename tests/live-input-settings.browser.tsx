// On an empty Vite page, import this module and call runLiveInputSettingsRegression().
// Exercises the real component; no capture, Core or installed data is touched.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { DeviceInputSettings } from "../src/client/sections/settings/sources/DeviceInputSettings";
import { SessionGateContext } from "../src/client/session/gate-context";
import type { SessionGateValue } from "../src/client/session/session-context";

const wait = () => new Promise(resolve => setTimeout(resolve, 50));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
export async function runLiveInputSettingsRegression() {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  let settle: (error?: Error) => void = () => {};
  let stops = 0;
  function Fixture() {
    const [published, setPublished] = useState(true);
    const gate = {
      connected: true,
      localLiveSourceId: published ? "source" : null,
      state: { liveSources: published ? [{ id: "source", name: "Studio · Screen" }] : [] },
      endLive: () => {
        stops++;
        // The real live session releases capture and its local identity before Core acknowledges.
        setPublished(false);
        return new Promise<void>((resolve, reject) => { settle = error => error ? reject(error) : resolve(); });
      },
    } as unknown as SessionGateValue;
    return <SessionGateContext value={gate}><DeviceInputSettings /></SessionGateContext>;
  }
  const routeTree = createRootRoute({ component: Fixture });
  const router = createRouter({ routeTree, history: createMemoryHistory() });
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === text);
  try {
    for (const fails of [false, true]) {
      root.render(<RouterProvider key={String(fails)} router={router} />);
      await new Promise(resolve => setTimeout(resolve, 250));
      assert(button("Stop sharing"), `Fixture did not render its published source: ${host.textContent}`);
      button("Stop sharing")!.click();
      await wait();
      assert(button("Stopping…")?.disabled, "Stopping vanished when capture was released before its acknowledgement");
      assert(host.textContent?.includes("Studio · Screen"), "The stopping source lost its name");
      assert(!button("Starting…") && !button("Cancel"), "A pending stop rendered the start/cancel controls");
      button("Stopping…")!.click();
      assert(stops === (fails ? 2 : 1), "A pending stop could be sent twice");
      settle(fails ? new Error("Generated stop acknowledgement failure") : undefined);
      await wait();
      assert(button("Start sharing") && !button("Stopping…"), "Settled stop did not return to capture setup");
      assert(!fails || host.querySelector('[role="alert"]')?.textContent?.includes("Generated stop acknowledgement failure"), "Stop failure was lost");
    }
    return { passed: true, checks: ["pending stop retains source", "no start/cancel during stop", "no duplicate stop", "success returns to setup", "failure remains visible"] };
  } finally { root.unmount(); host.remove(); }
}
