import { expect, test } from "bun:test";
import { readSearchState, searchDeadline, searchEndBounds, searchRelevance, searchSecondsLeft } from "../src/client/search";

const time = (hours: number, minutes: number) => new Date(2026, 9, 19, hours, minutes).getTime();

test("Ends by accepts only real 24-hour clock values", () => {
  for (const until of ["24:00", "24:99", "12:60", "99:99", "-1:00", "1:00"]) expect(readSearchState({ until }).until).toBeUndefined();
  for (const until of ["00:00", "12:59", "23:59"]) expect(readSearchState({ until }).until).toBe(until);
});

test("a selected deadline stays expired after its choice has left the suggested bounds", () => {
  const deadline = searchDeadline("17:30", time(17, 5));
  expect(searchEndBounds(time(17, 11)).some(bound => bound.value === "17:30")).toBe(false);
  expect(searchSecondsLeft(deadline, time(17, 11))).toBe(19 * 60);
  expect(searchSecondsLeft(deadline, time(17, 30))).toBe(0);
  expect(searchSecondsLeft(deadline, time(17, 31))).toBe(0);
  expect(searchSecondsLeft(searchDeadline("17:30", time(18, 0)), time(18, 0))).toBe(0);
});

test("generated deadlines cross midnight and still expire only once", () => {
  const now = time(23, 50), deadline = searchDeadline("00:30", now);
  expect(searchEndBounds(now)[0]?.value).toBe("00:30");
  expect(searchSecondsLeft(deadline, now)).toBe(40 * 60);
  expect(searchSecondsLeft(deadline, time(24, 31))).toBe(0);
  expect(searchSecondsLeft(deadline, time(48, 0))).toBe(0);
});

test("one-character words participate in close and strong matches", () => {
  const x = searchRelevance("x");
  expect(x.close({ title: "Unrelated", meta: "YouTube" })).toBe(false);
  expect(x.strong({ title: "X" })).toBe(true);
  const query = searchRelevance("a b");
  expect(query.strong({ title: "A beautiful day" })).toBe(true);
  expect(query.close({ title: "Radio", meta: "NTS" })).toBe(false);
  expect(searchRelevance("nts").close({ title: "Quints", meta: "" })).toBe(false);
  expect(searchRelevance("café").strong({ title: "Cafe\u0301 live" })).toBe(true);
});
