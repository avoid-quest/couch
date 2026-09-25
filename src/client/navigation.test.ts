import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { applyTvNavigation, useNavigation } from "./navigation";

function NavigationHarness() { useNavigation(() => {}); return null; }

test("D-pad enters the visible page control and Right stops at a result row edge", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement, KeyboardEvent: globalThis.KeyboardEvent, getComputedStyle: globalThis.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT };
  const window = new Window();
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, KeyboardEvent: window.KeyboardEvent, getComputedStyle: window.getComputedStyle.bind(window), IS_REACT_ACT_ENVIRONMENT: true });
  const prototype = window.HTMLElement.prototype;
  const rects = prototype.getClientRects, bounds = prototype.getBoundingClientRect, scroll = prototype.scrollIntoView;
  prototype.getBoundingClientRect = function () { const x = Number(this.dataset.x ?? 0), y = Number(this.dataset.y ?? 0); return { x, y, left: x, top: y, right: x + 80, bottom: y + 30, width: 80, height: 30, toJSON: () => ({}) } as ReturnType<typeof bounds>; };
  prototype.getClientRects = function () { return (this.style.display === "none" ? [] : [this.getBoundingClientRect()]) as ReturnType<typeof rects>; };
  prototype.scrollIntoView = () => {};
  const host = window.document.body.appendChild(window.document.createElement("div"));
  const root = createRoot(host as unknown as HTMLElement);
  try {
    window.document.body.insertAdjacentHTML("beforeend", '<main data-tv-navigation-scope><header class="app-header"><button id="local" data-tv-local-only data-x="0" data-y="0">Play on</button><button id="header" data-x="100" data-y="0">Find</button></header><section><button data-page-first style="display:none">Hidden select</button><button id="first" data-page-first data-x="0" data-y="50">First page control</button><div data-nav-row><button id="play" data-x="0" data-y="100">Play</button><button id="save" data-x="100" data-y="100">Save</button></div><div data-nav-row><button id="next" data-x="220" data-y="150">Next row</button></div></section></main>');
    await act(async () => root.render(createElement(NavigationHarness)));
    const local = window.document.getElementById("local") as unknown as HTMLElement;
    let localClicks = 0;
    local.addEventListener("click", () => localClicks++);
    local.focus();
    applyTvNavigation("select");
    expect(localClicks).toBe(0);
    applyTvNavigation("down");
    expect(window.document.activeElement?.id).toBe("header");
    (window.document.getElementById("header") as unknown as HTMLElement).focus();
    applyTvNavigation("down");
    expect(window.document.activeElement?.id).toBe("first");
    (window.document.getElementById("play") as unknown as HTMLElement).focus();
    applyTvNavigation("right");
    expect(window.document.activeElement?.id).toBe("save");
    applyTvNavigation("right");
    expect(window.document.activeElement?.id).toBe("save");
  } finally {
    await act(async () => root.unmount());
    prototype.getClientRects = rects; prototype.getBoundingClientRect = bounds; prototype.scrollIntoView = scroll;
    Object.assign(globalThis, previous);
    await window.happyDOM.abort();
  }
});

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
