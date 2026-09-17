import { afterAll, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionState } from "../../../shared/protocol";

let QueuePanel: typeof import("./QueuePanel").QueuePanel, queueMoveAction: typeof import("./QueuePanel").queueMoveAction;
const window = new Window();
const originals = new Map<string, PropertyDescriptor | undefined>();
beforeAll(async () => {
  for (const key of ["window", "document", "navigator"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : Reflect.get(window, key) });
  }
  // Radix chooses its layout-effect implementation when first imported.
  ({ QueuePanel, queueMoveAction } = await import("./QueuePanel"));
});
afterAll(async () => {
  await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});

const queue = ["First", "Current", "Next", "Last"].map(title => ({ id: title, title, source: `https://media.example/${title}` }));
const state: SessionState = { queue, currentEntryId: "Current", queueCursorEntryId: "Current", activeProfile: { id: "household", name: "Household" }, player: { playbackId: "playing", status: "playing", position: 5, duration: 100, volume: 80, seekable: true, error: null } };
function render(value: SessionState, editing = true) {
  const window = new Window();
  window.document.body.innerHTML = renderToStaticMarkup(<QueuePanel state={value} credentials={{ origin: "http://localhost", token: "paired" }} connected available nativeHost={false} defaultQuality="best" editing={editing} run={async () => true} />);
  return window.document;
}
const titles = (document: Window["document"], label: string) => [...document.querySelectorAll(`ol[aria-label="${label}"] .queue-entry-title`)].map(node => node.textContent);

test("current, upcoming and collapsed previous groups retain every row and full queue positions", () => {
  const document = render(state);
  expect(titles(document, "Current item")).toEqual(["Current"]);
  expect(titles(document, "Up next")).toEqual(["Next", "Last"]);
  expect(titles(document, "Previously queued")).toEqual(["First"]);
  expect(document.querySelector("details")?.hasAttribute("open")).toBe(false);
  expect([...document.querySelectorAll('ol[aria-label="Up next"] .queue-number')].map(node => node.textContent)).toEqual(["03", "04"]);
  expect(document.querySelectorAll(".queue-entry")).toHaveLength(queue.length);
});

test("stopped controllers use the saved position and legacy queues start entirely upcoming", () => {
  const stopped = render({ ...state, currentEntryId: null });
  expect(titles(stopped, "Current item")).toEqual([]);
  expect(titles(stopped, "Previously queued")).toEqual(["First", "Current"]);
  expect(titles(stopped, "Up next")).toEqual(["Next", "Last"]);
  const legacy = render({ ...state, currentEntryId: null, queueCursorEntryId: undefined });
  expect(titles(legacy, "Up next")).toEqual(queue.map(entry => entry.title));
  expect(legacy.querySelector("details")).toBeNull();
});

test("an exhausted queue preserves every previous entry and presents an empty Up next", () => {
  const document = render({ ...state, currentEntryId: null, queueCursorEntryId: "Last" });
  expect(titles(document, "Previously queued")).toEqual(queue.map(entry => entry.title));
  expect(document.querySelector(".queue-group-empty")?.textContent).toContain("Nothing queued next");
});

test("upcoming rows carry keyboard-reachable reorder handles only in edit mode", () => {
  const document = render(state, false);
  expect(document.querySelectorAll('button[aria-label^="Reorder"]')).toHaveLength(0);
  const editing = render(state);
  expect([...editing.querySelectorAll('button[aria-label^="Reorder"]')].map(node => node.getAttribute("aria-label"))).toEqual(["Reorder Next", "Reorder Last"]);
});

test("a drop becomes one persistent move command ahead of the new follower", () => {
  const upcoming = [queue[2]!, queue[3]!];
  expect(queueMoveAction(upcoming, "Last", "Next")).toEqual({ type: "move", entryId: "Last", beforeEntryId: "Next" });
  expect(queueMoveAction(upcoming, "Next", "Last")).toEqual({ type: "move", entryId: "Next", beforeEntryId: null });
  expect(queueMoveAction(upcoming, "Next", "Next")).toBeNull();
  // Current and previously queued entries are outside the sortable list.
  expect(queueMoveAction(upcoming, "Current", "Next")).toBeNull();
  expect(queueMoveAction(upcoming, "Next", "First")).toBeNull();
});
