import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { applyTvNavigation } from "./navigation";

test("a remote arrow wakes the hidden player band", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement, KeyboardEvent: globalThis.KeyboardEvent, getComputedStyle: globalThis.getComputedStyle };
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, KeyboardEvent: window.KeyboardEvent, getComputedStyle: window.getComputedStyle.bind(window) });
  try {
    window.document.body.innerHTML = '<main data-tv-navigation-scope><div class="player-band-hidden" inert></div></main>';
    const keys: string[] = [];
    window.addEventListener("keydown", event => { if ("key" in event) keys.push(String(event.key)); }, true);
    expect(applyTvNavigation("down")).toBe(true);
    expect(keys).toEqual(["ArrowDown"]);
  } finally {
    Object.assign(globalThis, previous);
    await window.happyDOM.abort();
  }
});
