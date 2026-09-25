import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { dispatchTvRoute } from "./session-context";

test("native TV Home closes an open dialog before navigating", async () => {
  const browser = new Window({ url: "http://localhost" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "Event", "KeyboardEvent", "HTMLElement", "getComputedStyle", "requestAnimationFrame"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "requestAnimationFrame" ? (callback: FrameRequestCallback) => { queueMicrotask(() => callback(0)); return 1; } : Reflect.get(browser, key);
    Object.defineProperty(globalThis, key, { configurable: true, value: typeof value === "function" && key === "getComputedStyle" ? value.bind(browser) : value });
  }
  try {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    const close = document.createElement("button");
    close.textContent = "Close";
    for (const element of [dialog, close]) element.getClientRects = () => [{ width: 100, height: 40 }] as unknown as DOMRectList;
    dialog.append(close);
    document.body.append(dialog);
    close.focus();
    const events: string[] = [];
    close.addEventListener("keydown", event => { if (event.key === "Escape") { events.push("dismiss"); dialog.remove(); } });
    window.addEventListener("couch-home", () => events.push("home"));

    dispatchTvRoute("home");
    expect(events).toEqual(["dismiss"]);
    await Promise.resolve();
    expect(events).toEqual(["dismiss", "home"]);
  } finally {
    await browser.happyDOM.abort();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
