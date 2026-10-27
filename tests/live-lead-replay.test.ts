import { expect, test } from "bun:test";
import { createLeadController, leadAt, leadDefaults, type LeadCommand } from "../src/server/live-lead";
import fixture from "./fixtures/live-lead-replay.json";

// Recorded prototype listener reports (long2-*, buf-web-*), replayed in arrival order as the prototype's
// lead-sim.mjs did; its decisions are the fixture's expected trajectories (lead-fast-results.json).
const rate = leadDefaults.rampMsPerSec;
class Ramp {
  commands: (LeadCommand & { fromMs: number })[] = [];
  constructor(readonly initial: number) {}
  at(us: number) { const command = this.commands.findLast(c => c.atServerUs <= us); return command ? leadAt(command, us, rate) : this.initial; }
  targetAt(us: number) { return this.commands.findLast(c => c.atServerUs <= us)?.leadMs ?? this.initial; }
  add(command: LeadCommand) { this.commands.push({ ...command, fromMs: this.at(command.atServerUs) }); }
  points(start: number, end: number) {
    return [start, end, ...this.commands.flatMap(c => [c.atServerUs, c.atServerUs + Math.abs(c.leadMs - c.fromMs) / rate * 1e6])].filter(t => t >= start && t <= end).sort((a, b) => a - b);
  }
  low(start: number, end: number) { return Math.min(...this.points(start, end).map(t => this.at(t))); }
  mean(start: number, end: number) { const p = this.points(start, end); return p.slice(1).reduce((sum, t, i) => sum + (t - p[i]!) * (this.at(t) + this.at(p[i]!)) / 2, 0) / (end - start); }
}
// The listener's cursor: an interval's worst need holds it at its start, then it catches up at the ramp rate.
function debtAfter(previous: { actualMs: number; us: number } | undefined, ramp: Ramp, start: number, end: number, needMs: number) {
  let actual = previous?.actualMs ?? ramp.at(start);
  if (previous && start > previous.us) { const change = ramp.targetAt(start) - actual; actual += Math.sign(change) * Math.min(Math.abs(change), (start - previous.us) / 1e6 * rate); }
  actual = Math.max(actual, needMs);
  const points = [...new Set([start, end, ...ramp.commands.map(c => c.atServerUs).filter(t => t > start && t < end)])].sort((a, b) => a - b);
  for (let i = 1; i < points.length; i++) {
    const seconds = (points[i]! - points[i - 1]!) / 1e6, change = Math.max(needMs, ramp.targetAt((points[i - 1]! + points[i]!) / 2)) - actual;
    actual += Math.sign(change) * Math.min(seconds, Math.abs(change) / rate) * rate;
  }
  return { actualMs: actual, us: end, debtMs: actual - ramp.targetAt(end) };
}

for (const run of fixture.runs) test(`replayed ${run.name} reports make the prototype's lead decisions`, () => {
  const controller = createLeadController({ initialLeadMs: run.leadMs }), ramp = new Ramp(Math.min(run.leadMs, leadDefaults.maxLeadMs));
  const sessions = new Map<string, string>(), generations = new Map<string, number>(), previous = new Map<string, number>(), cursors = new Map<string, ReturnType<typeof debtAfter>>();
  const admissions: [string, number][] = [];
  let shortfall = 0;
  const accept = (result: ReturnType<typeof controller.current>) => {
    if (result.command) ramp.add(result.command);
    for (const d of result.decisions) if (d.type === "admission") admissions.push([d.id, d.atServerUs]);
  };
  const join = (name: string, us: number) => {
    const id = `${name}#${(generations.get(name) ?? 0) + 1}`;
    generations.set(name, (generations.get(name) ?? 0) + 1); sessions.set(name, id); previous.delete(name); cursors.delete(name);
    accept(controller.add(id, us)); return id;
  };
  type Event = { kind: string; name?: string; time: number; row?: (number | null)[] };
  const events: Event[] = run.events.map(([kind, name, us]) => ({ kind: kind as string, name: name as string, time: us as number }));
  for (const [name, rows] of Object.entries(run.listeners)) for (const row of rows) events.push({ kind: "stats", name, time: row[0]!, row });
  const end = Math.max(...events.map(e => e.time));
  for (let time = run.startUs; time <= end; time += 1e6) events.push({ kind: "tick", time });
  events.sort((a, b) => a.time - b.time);
  for (const e of events) {
    if (e.kind === "join") { join(e.name!, e.time); continue; }
    if (e.kind === "leave") { const id = sessions.get(e.name!); if (id) accept(controller.remove(id, e.time)); sessions.delete(e.name!); continue; }
    if (e.kind === "tick") { accept(controller.tick(e.time)); continue; }
    const [, marginMinMs, headroomMinMs, arrivalGapMaxMs, resyncs, recovering] = e.row!, name = e.name!, id = sessions.get(name) ?? join(name, e.time);
    const start = Math.max(e.time - 1e6, previous.get(name) ?? e.time - 1e6);
    previous.set(name, e.time);
    if (marginMinMs === null) continue;
    const needMs = Math.max(0, run.leadMs - marginMinMs!), cursor = debtAfter(cursors.get(name), ramp, start, e.time, needMs);
    cursors.set(name, cursor);
    if (ramp.low(start, e.time) < needMs) shortfall++;
    accept(controller.observe(id, { leadMs: run.leadMs, marginMinMs, needMs, debtMs: cursor.debtMs, headroomMinMs, arrivalGapMaxMs, resyncs, recovering: !!recovering }, e.time));
  }
  expect(ramp.commands.map(c => [c.leadMs, c.atServerUs])).toEqual(run.expected.trajectory);
  expect(admissions).toEqual(run.expected.admissions as [string, number][]);
  expect(shortfall).toBe(run.expected.shortfall);
  const first = Math.min(...events.filter(e => e.kind === "stats").map(e => e.time)) - 1e6;
  expect(ramp.mean(first, end)).toBeCloseTo(run.expected.meanMs, 9);
});
