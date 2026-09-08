import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { PlayerState } from "../shared/protocol";
import { useTvPresentation } from "./useTvPresentation";

test("TV browsing and focus survive a replacement transport; new media and Stop retain their screen behavior", async () => {
  const window = new Window({ url: "http://localhost" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  let presentation!: ReturnType<typeof useTvPresentation>;
  function View({ presentationId, playbackId, phase }: { presentationId: string | null; playbackId: string | null; phase: PlayerState["status"] }) {
    presentation = useTvPresentation({ enabled: true, presentationId, playbackId, phase });
    return <><div className="tv-browser" hidden={!presentation.browsing}><div className="media-browser"><button id="settings">Settings</button></div></div><div className="tv-playback-controls" hidden={presentation.browsing || !presentation.controlsVisible}><button className="play-button">Pause</button></div></>;
  }
  const render = (presentationId: string | null, playbackId: string | null, phase: PlayerState["status"]) => act(async () => root.render(<View presentationId={presentationId} playbackId={playbackId} phase={phase} />));
  const frame = () => act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  try {
    await render(null, null, "idle");
    const settings = document.querySelector<HTMLButtonElement>("#settings")!;
    settings.getClientRects = () => [new window.DOMRect(0, 0, 100, 44)] as unknown as DOMRectList;
    settings.focus();
    await render("one", "original", "playing");
    expect(presentation.browsing).toBe(false);
    expect(presentation.controlsVisible).toBe(true);
    await act(async () => presentation.openHome());
    await frame();
    expect(presentation.browsing).toBe(true);
    expect(document.activeElement === settings).toBe(true);
    await render("one", "quality-replacement", "loading");
    expect(presentation.browsing).toBe(true);
    expect(presentation.controlsVisible).toBe(false);
    expect(document.activeElement === settings).toBe(true);
    await render("one", "quality-replacement", "paused");
    expect(presentation.browsing).toBe(true);
    expect(presentation.controlsVisible).toBe(false);
    expect(document.activeElement === settings).toBe(true);
    // Explicit Play of this same queue item receives a new presentation identity.
    await render("one-replay", "explicit-replay", "loading");
    expect(presentation.browsing).toBe(false);
    await act(async () => presentation.openHome());
    await frame();
    await render("two", "next-item", "loading");
    expect(presentation.browsing).toBe(false);
    expect(presentation.controlsVisible).toBe(true);
    await render(null, null, "idle");
    await frame();
    expect(presentation.browsing).toBe(true);
    expect(presentation.controlsVisible).toBe(false);
    expect(document.activeElement === settings).toBe(true);
    await render("two", "replay-after-stop", "loading");
    expect(presentation.browsing).toBe(false);
  } finally {
    await act(async () => root.unmount());
    window.happyDOM.abort();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
