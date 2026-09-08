import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionState } from "../shared/protocol";
import { QueuePanel } from "./QueuePanel";

const queue = ["First", "Current", "Next", "Last"].map(title => ({ id: title, title, source: `https://media.example/${title}` }));
const state: SessionState = { queue, currentEntryId: "Current", queueCursorEntryId: "Current", activeProfile: { id: "household", name: "Household" }, player: { playbackId: "playing", status: "playing", position: 5, duration: 100, volume: 80, seekable: true, error: null } };
function render(value: SessionState) {
  const window = new Window();
  window.document.body.innerHTML = renderToStaticMarkup(<QueuePanel state={value} credentials={{ origin: "http://localhost", token: "paired" }} connected available nativeHost={false} defaultQuality="best" run={async () => true} />);
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
