import { afterAll, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionState } from "../../../shared/protocol";

let QueuePanel: typeof import("./QueuePanel").QueuePanel;
const window = new Window();
const originals = new Map<string, PropertyDescriptor | undefined>();
beforeAll(async () => {
  for (const key of ["window", "document", "navigator"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : Reflect.get(window, key) });
  }
  ({ QueuePanel } = await import("./QueuePanel"));
});
afterAll(async () => {
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});

const queue = ["Played", "Current", "Next", "Last"].map((title, index) => ({ id: title, title, source: `https://media.example/${title}`, duration: (index + 1) * 60 }));
const state: SessionState = { queue, currentEntryId: "Current", queueCursorEntryId: "Current", activeProfile: { id: "household", name: "Household" }, player: { playbackId: "playing", status: "playing", position: 5, duration: 120, volume: 80, seekable: true, error: null } };
function render(value: SessionState) {
  const window = new Window();
  window.document.body.innerHTML = renderToStaticMarkup(<QueuePanel state={value} credentials={{ origin: "http://localhost", token: "paired" }} connected available nativeHost={false} defaultQuality="best" run={async () => true} />);
  return window.document;
}

const titles = (document: Window["document"], label: string) => [...document.querySelectorAll(`ol[aria-label="${label}"] button[aria-label^="Play "]`)].map(node => node.getAttribute("aria-label"));

test("the queue shows upcoming and played items without a legacy presentation", () => {
  const document = render(state);
  expect(titles(document, "Up next")).toEqual(["Play Next", "Play Last"]);
  expect(titles(document, "Played")).toEqual(["Play Played"]);
  expect(document.querySelector("#queue-next-title")?.textContent).toContain("2 to play, done by");
  expect(document.querySelectorAll(".queue-row-actions")).toHaveLength(2);
});

test("unknown or live lengths suppress uncertain start and done by times", () => {
  const document = render({ ...state, queue: [queue[0]!, queue[1]!, { ...queue[2]!, duration: undefined }, queue[3]!] });
  expect(document.querySelector("#queue-next-title")?.textContent).toBe("2 to play");
  const metas = [...document.querySelectorAll(".queue-standard-meta")].map(node => node.textContent);
  expect(metas[0]).toContain("Length unknown, starts ");
  expect(metas[1]).toBe("4:00");
  const live = render({ ...state, queue: [queue[0]!, { ...queue[1]!, live: true }, queue[2]!, queue[3]!] });
  expect(live.querySelector("#queue-next-title")?.textContent).toBe("2 to play");
  expect([...live.querySelectorAll(".queue-standard-meta")].every(node => !node.textContent?.includes("starts"))).toBe(true);
});

test("a stopped queue honors its cursor and an exhausted queue gives a useful empty state", () => {
  const stopped = render({ ...state, currentEntryId: null });
  expect(titles(stopped, "Played")).toEqual(["Play Current", "Play Played"]);
  expect(titles(stopped, "Up next")).toEqual(["Play Next", "Play Last"]);
  const exhausted = render({ ...state, currentEntryId: null, queueCursorEntryId: "Last" });
  expect(titles(exhausted, "Up next")).toEqual([]);
  expect(exhausted.querySelector("[data-slot=empty]")?.textContent).toContain("Nothing queued");
});
