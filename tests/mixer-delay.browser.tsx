// Render the real mixer through a connection change while its sync slider holds an edit.
import { createRoot } from "react-dom/client";
import { Mixer } from "../src/client/sections/shell/Outputs";
import { deviceId } from "../src/client/session/device-id";
import type { ClientSessionState } from "../src/client/session/session";

export async function runMixerDelayRegression() {
  const root = createRoot(document.getElementById("fixture")!);
  const here = deviceId();
  const wait = () => new Promise(resolve => setTimeout(resolve, 80));
  const render = async (connected: boolean, delay: number) => {
    const outputs = [{ deviceId: here, picture: true, sound: true }, { deviceId: "tv", picture: false, sound: true, delay, delayActive: true }];
    const state = {
      playback: "p", controlling: here, currentEntryId: "film", queue: [{ id: "film", title: "Film", source: "fixture.mp4" }],
      devices: [here, "tv"].map(id => ({ id, name: id === here ? "This device" : "TV", online: true, volume: 50, muted: false, sharing: { audio: true, video: true } })),
      outputs, playbacks: [{ id: "p", title: "Film", status: "playing", outputs }],
      player: { playbackId: "p", status: "playing", volume: 50, muted: false },
    } as ClientSessionState;
    root.render(<Mixer state={state} connected={connected} run={async () => true} />);
    await wait();
  };
  const slider = () => document.querySelector<HTMLElement>('[data-sync-line="tv"] [role="slider"]')!;
  try {
    await render(true, 80);
    slider().focus();
    slider().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    await wait();
    if (slider().getAttribute("aria-valuenow") !== "90") throw new Error("Sync edit did not start");
    await render(false, 120);
    if (slider().getAttribute("aria-valuenow") !== "120") throw new Error("Disabled sync slider kept its stale draft");
    await render(true, 140);
    if (slider().getAttribute("aria-valuenow") !== "140") throw new Error("Reconnected sync slider did not show the received delay");
    return { passed: true };
  } finally { root.unmount(); }
}
