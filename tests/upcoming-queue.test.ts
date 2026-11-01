import { expect, test } from "bun:test";
import { upcomingQueue } from "../src/shared/queue";

const queue = ["one", "two", "three"].map(id => ({ id, title: id, source: `https://example.com/${id}` }));

test.each([
  ["before playback", null, undefined, ["one", "two", "three"]],
  ["current item takes precedence over a later cursor", "one", "three", ["two", "three"]],
  ["stopped partway through", null, "two", ["three"]],
  ["stale current item falls back to the cursor", "removed", "two", ["three"]],
] as const)("Up next selects only upcoming entries: %s", (_name, currentEntryId, queueCursorEntryId, expected) => {
  expect(upcomingQueue({ queue, currentEntryId, queueCursorEntryId }).map(entry => entry.id)).toEqual([...expected]);
});
