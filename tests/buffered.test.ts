import { expect, test } from "bun:test";
import { bufferedEnd } from "../src/client/session/buffered";

const ranges = (...spans: [number, number][]) => ({ length: spans.length, start: (index: number) => spans[index]![0], end: (index: number) => spans[index]![1] });

test("the loaded segment ends where the range holding the playhead ends", () => {
  expect(bufferedEnd(ranges([0, 30]), 12)).toBe(30);
  expect(bufferedEnd(ranges(), 12)).toBeNull();
  expect(bufferedEnd(ranges([0, 10], [40, 60]), 20)).toBeNull();
  expect(bufferedEnd(ranges([0, 10], [40, 60], [90, 95]), 45)).toBe(60);
});
