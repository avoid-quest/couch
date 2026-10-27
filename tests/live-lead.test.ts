import { expect, test } from "bun:test";
import { createLeadController, elasticCost, leadDefaults, requiredLead } from "../src/server/live-lead";

const at = (seconds: number) => seconds * 1e6;
const status = (snapshot: ReturnType<ReturnType<typeof createLeadController>["current"]>, id: string) => snapshot.listeners.find(s => s.id === id)!;

test("a listener's need removes its cursor lag once, from the best figure it reports", () => {
  expect(requiredLead({ leadMs: 60, marginMinMs: 20, debtMs: 5 })).toBe(45);
  expect(requiredLead({ leadMs: 60, marginMinMs: 20, debtMs: -1 })).toBe(39);
  expect(requiredLead({ leadMs: 60, deadlineMarginMinMs: 15, debtMs: 5 })).toBe(45);
  expect(requiredLead({ leadMs: 100, marginMinMs: 110, debtMs: 50 })).toBe(40);
  expect(requiredLead({ needMs: 12, leadMs: 100, marginMinMs: 0 })).toBe(12);
  expect(requiredLead({ leadMs: 100, marginMinMs: null })).toBeNull();
  expect(requiredLead({ leadMs: 100, marginMinMs: Infinity })).toBeNull();
});

test("one interval peak is held; two consecutive reports command a future ramp", () => {
  const c = createLeadController({ warmupSec: 0, initialLeadMs: 20 });
  expect(c.observe("a", { needMs: 40 }, 0).command).toBeNull();
  expect(c.observe("a", { needMs: 15 }, at(1)).command).toBeNull();
  expect(c.observe("a", { needMs: 35 }, at(2)).command).toBeNull();
  const r = c.observe("a", { needMs: 38 }, at(3));
  expect(r.command).toEqual({ type: "lead", leadMs: 41, atServerUs: at(3) + leadDefaults.commandAheadMs * 1000 });
  expect(r.effectiveLeadMs).toBe(20);
  expect(c.current(r.command!.atServerUs + at(0.5)).effectiveLeadMs).toBe(30);
  expect(c.current(r.rampEndUs).effectiveLeadMs).toBe(41);
});

test("a changing effective lead cannot reduce the inferred need", () => {
  const c = createLeadController({ warmupSec: 0, initialLeadMs: 20 });
  c.observe("a", { leadMs: 20, marginMinMs: -20 }, 0);
  const r = c.observe("a", { leadMs: 20, marginMinMs: -20 }, at(1));
  const time = r.command!.atServerUs + at(3), effective = c.current(time).effectiveLeadMs;
  const after = c.observe("a", { leadMs: effective, marginMinMs: effective - 40 }, time);
  expect(after.listeners[0]!.needMs).toBe(40);
  expect(after.leadMs).toBe(43);
});

test("lowering waits for twelve seconds of evidence, then spends ten ms every six seconds on a continuous ramp", () => {
  const c = createLeadController({ initialLeadMs: 80, warmupSec: 0 });
  let r = c.current(0);
  for (let s = 0; s < 12; s++) expect((r = c.observe("a", { needMs: 20, debtMs: 2 }, at(s))).leadMs).toBe(80);
  r = c.observe("a", { needMs: 20, debtMs: 2 }, at(12));
  expect(r.command?.leadMs).toBe(70);
  expect(c.current(r.command!.atServerUs).effectiveLeadMs).toBe(80);
  expect(c.current(r.command!.atServerUs + at(0.25)).effectiveLeadMs).toBe(75);
  for (let s = 13; s < 18; s++) expect(c.observe("a", { needMs: 20 }, at(s)).command).toBeNull();
  expect(c.observe("a", { needMs: 20 }, at(18)).leadMs).toBe(60);
});

test("a need beyond the maximum raises to the cap, then plays behind until an operator drops it", () => {
  const c = createLeadController({ warmupSec: 0, initialLeadMs: 30, maxLeadMs: 80 });
  c.observe("a", { needMs: 20 }, 0); c.observe("b", { needMs: 20 }, 0);
  for (let s = 1; s <= 3; s++) { c.observe("a", { needMs: 60 }, at(s)); c.observe("b", { needMs: 60 }, at(s)); }
  expect(c.current(at(3)).leadMs).toBe(63);
  let r = c.current(at(3));
  for (let s = 4; s <= 50; s++) {
    c.observe("a", { needMs: 60 }, at(s)); c.observe("b", { needMs: 60 }, at(s));
    r = c.observe("c", { needMs: 500, debtMs: 420 }, at(s));
    expect(r.decisions.some(d => d.type === "drop")).toBe(false);
  }
  expect(r.leadMs).toBe(80);
  expect(status(r, "c")).toMatchObject({ status: "behind", behindMs: 420, requiredExtraMs: 420, admission: "admitted" });
  expect(status(r, "a").status).toBe("ok");
  const dropped = c.drop("c", at(50));
  expect(dropped.decisions).toContainEqual({ type: "drop", id: "c", reason: "Removed by the host", atServerUs: at(50) });
  expect(status(dropped, "c").status).toBe("removed");
});

test("stale reports keep the listener but report behind as unknown; a reconnect starts warming again", () => {
  const c = createLeadController({ warmupSec: 0, initialLeadMs: 150, maxLeadMs: 80, staleSec: 3 });
  expect(c.current(0).leadMs).toBe(80);
  for (let s = 0; s <= 4; s++) c.observe("a", { needMs: 100, debtMs: 20 }, at(s));
  expect(status(c.current(at(4)), "a")).toMatchObject({ requiredExtraMs: 20, admission: "admitted", behindMs: 20 });
  expect(status(c.tick(at(8)), "a")).toMatchObject({ status: "stale", behindMs: null });
  c.remove("a", at(8)); c.add("a", at(8));
  expect(status(c.current(at(8)), "a")).toMatchObject({ status: "warming", needMs: null });
  expect(c.observe("a", { marginMinMs: null }, at(9)).listeners[0]!.needMs).toBeNull();
  expect(() => c.tick(at(6))).toThrow(/nondecreasing/);
  expect(() => createLeadController({ initialLeadMs: NaN })).toThrow(/initialLeadMs/);
});

test("cold-start need is visible but never enters the group's ongoing need", () => {
  const c = createLeadController({ initialLeadMs: 30 });
  for (let s = 0; s < 20; s++) {
    const r = c.observe("slow-start", { needMs: s < 10 ? 500 : 20 }, at(s));
    expect(r.leadMs).toBe(30); expect(r.listeners[0]).toMatchObject({ admission: "warming", status: "warming" });
  }
  c.observe("slow-start", { needMs: 20 }, at(20));
  const r = c.observe("slow-start", { needMs: 20 }, at(21));
  expect(r.listeners[0]).toMatchObject({ startupNeedMs: 500, needMs: 20, admission: "admitted" });
  expect(r.leadMs).toBe(30);
  expect(r.decisions.some(d => d.type === "admission")).toBe(true);
});

test("a new command never overtakes the outstanding epoch", () => {
  const c = createLeadController({ warmupSec: 0, initialLeadMs: 20, commandAheadMs: 2000 });
  c.observe("a", { needMs: 30 }, 0);
  const first = c.observe("a", { needMs: 30 }, at(1));
  expect(c.observe("a", { needMs: 60 }, at(2)).command).toBeNull();
  const second = c.observe("a", { needMs: 60 }, at(3));
  expect(second.command!.atServerUs).toBeGreaterThan(first.command!.atServerUs);
  expect(c.current(at(5)).effectiveLeadMs).toBe(33);
});

test("fixed only reports, and the operator's bounds clip the lead", () => {
  const c = createLeadController({ initialLeadMs: 40, minLeadMs: 30, maxLeadMs: 200, fixed: true, warmupSec: 0 });
  for (let s = 0; s < 60; s++) {
    const r = c.observe("a", { needMs: 600, debtMs: 560 }, at(s));
    expect(r.command).toBeNull(); expect(r.leadMs).toBe(40); expect(r.listeners[0]!.behindMs).toBe(560);
  }
  expect(createLeadController({ initialLeadMs: 150 }).current(0).leadMs).toBe(100);
  expect(createLeadController({ initialLeadMs: 5, minLeadMs: 15 }).current(0).leadMs).toBe(15);
  expect(() => createLeadController({ initialLeadMs: 50, minLeadMs: 101 })).toThrow(/minLeadMs/);
  expect(() => createLeadController({ initialLeadMs: 50, raiseForSlowest: "false" as unknown as boolean })).toThrow(/raiseForSlowest/);
});

test("without raising for the slowest, an outlier plays behind while the others still set the lead", () => {
  const c = createLeadController({ initialLeadMs: 40, raiseForSlowest: false, warmupSec: 0 });
  let r = c.current(0);
  for (let s = 0; s <= 12; s++) { c.observe("a", { needMs: 20 }, at(s)); r = c.observe("slow", { needMs: 600, debtMs: 560 }, at(s)); }
  expect(r.leadMs).toBe(30);
  expect(status(r, "slow")).toMatchObject({ status: "behind", behindMs: 560 });
  expect(status(r, "a").status).toBe("limiting");
  for (let s = 13; s <= 15; s++) { c.observe("a", { needMs: 60 }, at(s)); r = c.observe("slow", { needMs: 62 }, at(s)); }
  expect(r.leadMs).toBe(65);
  const alone = createLeadController({ initialLeadMs: 20, raiseForSlowest: false, warmupSec: 0 });
  alone.observe("a", { needMs: 40 }, 0);
  expect(alone.observe("a", { needMs: 40 }, at(1)).command?.leadMs).toBe(43);
});

test("elastic costs distinguish isolated repayment from a sustained deficit", () => {
  const isolated = elasticCost([{ needMs: 10 }, { needMs: 14 }, { needMs: 10 }], 10, 20, 3);
  expect(isolated.debtMsPerHour).toBe(4800);
  expect(isolated.areaMsSecondsPerHour).toBeCloseTo(5280, 9);
  const sustained = elasticCost([{ needMs: 14 }, { needMs: 14 }, { needMs: 14 }], 10, 20, 3);
  expect(sustained.debtMsPerHour).toBe(4800);
  expect(sustained.areaMsSecondsPerHour).toBeGreaterThan(isolated.areaMsSecondsPerHour);
});

test("unpaid debt and the minimum gate lowering", () => {
  for (const debtMs of [0, 10]) {
    const c = createLeadController({ initialLeadMs: 40, minLeadMs: 35, warmupSec: 0 });
    for (let s = 0; s <= 30; s++) c.observe("a", { needMs: 10, debtMs }, at(s));
    expect(c.current(at(30)).leadMs).toBe(debtMs ? 40 : 35);
    expect(c.tick(at(60)).command).toBeNull();
  }
});
