import { setupUiTests, render, screen } from "./testing/react";
import { expect, spyOn, test } from "bun:test";
import { createElement } from "react";
import { applyTvNavigation, useNavigation } from "./navigation";

setupUiTests();

function NavigationHarness() { useNavigation(() => {}); return null; }

test("D-pad enters the visible page control and Right stops at a result row edge", () => {
  const positions = new Map<HTMLElement, [number, number]>();
  spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const [x, y] = positions.get(this) ?? [0, 0];
    return { x, y, left: x, top: y, right: x + 80, bottom: y + 30, width: 80, height: 30, toJSON: () => ({}) } as DOMRect;
  });
  spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.hidden ? [] : [this.getBoundingClientRect()]) as unknown as DOMRectList;
  });
  spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  const view = render(createElement(NavigationHarness));
  view.container.insertAdjacentHTML("beforeend", '<main data-tv-navigation-scope><header class="app-header"><button data-tv-local-only>Play on</button><button>Find</button></header><section><button data-page-first hidden>Hidden select</button><button data-page-first>First page control</button><div data-nav-row><button>Play</button><button>Save</button></div><div data-nav-row><button>Next row</button></div></section></main>');
  const button = (name: string) => screen.getByRole("button", { name });
  positions.set(button("Find"), [100, 0]);
  positions.set(button("First page control"), [0, 50]);
  positions.set(button("Play"), [0, 100]);
  positions.set(button("Save"), [100, 100]);
  positions.set(button("Next row"), [220, 150]);
  let localClicks = 0;
  button("Play on").addEventListener("click", () => localClicks++);
  button("Play on").focus();
  applyTvNavigation("select");
  expect(localClicks).toBe(0);
  applyTvNavigation("down");
  expect(button("Find")).toHaveFocus();
  applyTvNavigation("down");
  expect(button("First page control")).toHaveFocus();
  button("Play").focus();
  applyTvNavigation("right");
  expect(button("Save")).toHaveFocus();
  applyTvNavigation("right");
  expect(button("Save")).toHaveFocus();
});

test("a remote arrow wakes the hidden player band", () => {
  const view = render(null);
  view.container.innerHTML = '<main data-tv-navigation-scope><div data-player-band="hidden" inert></div></main>';
  const keys: string[] = [];
  const listener = (event: KeyboardEvent) => keys.push(event.key);
  window.addEventListener("keydown", listener, true);
  try {
    expect(applyTvNavigation("down")).toBe(true);
    expect(keys).toEqual(["ArrowDown"]);
  } finally { window.removeEventListener("keydown", listener, true); }
});
