// One shared Live lead for every listener of a source (docs/live-audio.md). No clocks, sockets or I/O:
// callers pass host time in microseconds. Ported from the prototype's elastic policy; its calibration
// is in .scratch/live-transport/LEAD.md.
export const leadDefaults = Object.freeze({ hysteresisMs: 3, historySec: 12, warmupSec: 20, staleSec: 20, rampMsPerSec: 20,
  commandAheadMs: 28, maxLeadMs: 100, minLeadMs: 0, raiseForSlowest: true, fixed: false, loweringStepMs: 10, lowerEverySec: 6,
  debtMsPerHour: 3600, debtAreaFraction: 0.05 });
export type LeadPolicy = { [K in keyof typeof leadDefaults]: typeof leadDefaults[K] extends boolean ? boolean : number };
export type LeadStats = Partial<Record<"needMs" | "leadMs" | "deadlineMarginMinMs" | "marginMinMs" | "debtMs" | "arrivalGapMaxMs" | "headroomMinMs" | "resyncs", number | null>> & { recovering?: boolean };
export type LeadCommand = { type: "lead"; leadMs: number; atServerUs: number };
export type LeadDecision = (LeadCommand & { reason: string | null; fromMs: number; rampEndUs: number })
  | { type: "admission"; id: string; admission: "admitted"; atServerUs: number; reason: string }
  | { type: "leave" | "drop"; id: string; atServerUs: number; reason?: string };
export type LeadStatus = "warming" | "ok" | "limiting" | "behind" | "stale" | "removed";
export type LeadListener = { id: string; status: LeadStatus; admission: "warming" | "admitted" | "removed"; needMs: number | null; startupNeedMs: number;
  debtMs: number; behindMs: number | null; requiredExtraMs: number | null; reason: string | null };
export type LeadSnapshot = { leadMs: number; effectiveLeadMs: number; atServerUs: number; rampEndUs: number; command: LeadCommand | null; decisions: LeadDecision[]; listeners: LeadListener[] };
type Row = { us: number; needMs: number; deliveryMs: number };
type Trajectory = { fromMs: number; leadMs: number; atServerUs: number };
type State = { id: string; lastUs: number; observedUs?: number; firstUs: number | null; warmFirstUs: number | null; warmReports: number; startupNeedMs: number;
  warmed: boolean; rows: Row[]; needMs: number | null; debtMs: number; recovering: boolean; admission: LeadListener["admission"]; reason?: string };
const finite = (value: unknown): value is number => Number.isFinite(value);

// One-second interval peaks, not a packet probability. Repeated equal deficits are one episode.
export function elasticCost(rows: { needMs: number }[], candidate: number, rate: number, seconds: number) {
  let previous = 0, debt = 0, area = 0;
  for (const row of rows) {
    const deficit = Math.max(0, row.needMs - candidate);
    debt += Math.max(0, deficit - previous);
    area += deficit + Math.max(0, deficit * deficit - previous * previous) / (2 * rate);
    previous = deficit;
  }
  return { debtMsPerHour: debt * 3600 / seconds, areaMsSecondsPerHour: area * 3600 / seconds };
}

// The lead a listener needed in its last report: its own figure first, then paired deadline margin, then margin and debt.
export function requiredLead(stats: LeadStats) {
  if (finite(stats.needMs)) return Math.max(0, stats.needMs);
  if (!finite(stats.leadMs)) return null;
  if (finite(stats.deadlineMarginMinMs)) return Math.max(0, stats.leadMs - stats.deadlineMarginMinMs);
  if (!finite(stats.marginMinMs)) return null;
  return Math.max(0, stats.leadMs - stats.marginMinMs + (finite(stats.debtMs) ? stats.debtMs : 0));
}

export function leadAt(trajectory: Trajectory, us: number, rate: number) {
  const change = trajectory.leadMs - trajectory.fromMs;
  return trajectory.fromMs + Math.sign(change) * Math.min(Math.abs(change), Math.max(0, us - trajectory.atServerUs) / 1e6 * rate);
}

/** Automatic raises after two reports above the lead and lowers by cost; fixed only reports. Only drop() removes a listener. */
export function createLeadController(options: Partial<LeadPolicy> & { initialLeadMs: number }) {
  const policy: LeadPolicy = { ...leadDefaults, ...options }, initial = options.initialLeadMs;
  if (!finite(initial) || initial < 0) throw new RangeError("initialLeadMs must be finite and nonnegative");
  if (typeof policy.raiseForSlowest !== "boolean" || typeof policy.fixed !== "boolean") throw new RangeError("raiseForSlowest and fixed are booleans");
  if (!finite(policy.minLeadMs) || policy.minLeadMs < 0 || policy.minLeadMs > policy.maxLeadMs) throw new RangeError("minLeadMs");
  for (const key of ["hysteresisMs", "historySec", "staleSec", "rampMsPerSec", "commandAheadMs", "maxLeadMs", "loweringStepMs", "lowerEverySec", "debtMsPerHour", "debtAreaFraction"] as const)
    if ((key !== "maxLeadMs" || policy[key] !== Infinity) && (!finite(policy[key]) || policy[key] <= 0)) throw new RangeError(`${key} must be positive`);
  if (!finite(policy.warmupSec) || policy.warmupSec < 0) throw new RangeError("warmupSec");
  const listeners = new Map<string, State>();
  let target = Math.max(policy.minLeadMs, Math.min(initial, policy.maxLeadMs)), clock: number | null = null, changedUs: number | null = null, pending: Trajectory | null = null;
  let trajectory: Trajectory = { fromMs: target, leadMs: target, atServerUs: 0 };
  const effective = (us: number) => leadAt(trajectory, us, policy.rampMsPerSec);
  const endUs = () => trajectory.atServerUs + Math.abs(trajectory.leadMs - trajectory.fromMs) / policy.rampMsPerSec * 1e6;
  const admitted = () => [...listeners.values()].filter(s => s.admission === "admitted");
  // With raising for the slowest off, a listener whose recent need alone exceeds every other's by the
  // hysteresis neither raises nor holds the group: it plays behind.
  const recent = (s: State) => Math.max(0, ...s.rows.slice(-2).map(r => r.needMs));
  const deciding = () => {
    const all = admitted();
    if (policy.raiseForSlowest || all.length < 2) return all;
    return all.filter(s => recent(s) <= Math.max(...all.filter(other => other !== s).map(recent)) + policy.hysteresisMs);
  };

  function advance(us: number) {
    if (!finite(us) || (clock !== null && us < clock)) throw new RangeError("host time must be finite and nondecreasing");
    if (pending && us >= pending.atServerUs) { trajectory = pending; pending = null; }
    clock = us; changedUs ??= us;
  }
  function snapshot(us: number, decisions: LeadDecision[] = [], command: LeadCommand | null = null): LeadSnapshot {
    const scheduled = pending ?? trajectory, setting = new Set(policy.fixed ? [] : deciding());
    const limiting = Math.max(0, ...[...setting].map(s => s.needMs ?? 0));
    return { leadMs: target, effectiveLeadMs: effective(us), atServerUs: scheduled.atServerUs,
      rampEndUs: scheduled.atServerUs + Math.abs(scheduled.leadMs - scheduled.fromMs) / policy.rampMsPerSec * 1e6,
      command, decisions, listeners: [...listeners.values()].map(s => {
        const stale = us - s.lastUs >= policy.staleSec * 1e6, behindMs = Math.max(0, s.debtMs);
        const status: LeadStatus = s.admission === "removed" ? "removed" : stale ? "stale" : behindMs > 0 ? "behind"
          : s.admission === "warming" ? "warming" : setting.has(s) && (s.needMs ?? 0) + policy.hysteresisMs >= limiting ? "limiting" : "ok";
        return { id: s.id, status, admission: s.admission, needMs: s.needMs, startupNeedMs: s.startupNeedMs, debtMs: s.debtMs, behindMs: stale ? null : behindMs,
          requiredExtraMs: s.needMs === null ? null : Math.max(0, s.needMs - target),
          reason: s.admission === "removed" ? s.reason ?? null : stale ? "stats are stale; retaining last requirement"
            : status === "behind" ? `behind by ${behindMs.toFixed(1)} ms` : s.admission === "warming" ? "warming up" : status === "limiting" ? "sets group lead" : null };
      }) };
  }
  function add(id: string, us: number) {
    advance(us);
    if (!listeners.has(id)) listeners.set(id, { id, lastUs: us, firstUs: null, warmFirstUs: null, warmReports: 0, startupNeedMs: 0,
      warmed: policy.warmupSec === 0, rows: [], needMs: null, debtMs: 0, recovering: false, admission: "warming" });
    return snapshot(us);
  }
  function decide(us: number, decisions: LeadDecision[] = []) {
    if (policy.fixed) return snapshot(us, decisions);
    const group = deciding();
    let desired = target, why: string | null = null;
    for (const s of group) {
      // Each report is an interval maximum. Two consecutive reports confirm persistence or burst recurrence.
      const high = s.rows.slice(-2).filter(r => r.needMs + policy.hysteresisMs > target);
      if (high.length >= 2) {
        const candidate = Math.ceil(Math.max(...high.map(r => r.needMs)) + policy.hysteresisMs);
        if (candidate > desired) { desired = candidate; why = "confirmed ongoing need"; }
      }
    }
    if (!why && group.length && !pending && us >= endUs() && us - changedUs! >= policy.lowerEverySec * 1e6 &&
        group.every(s => us - s.lastUs < policy.staleSec * 1e6 && us - s.firstUs! >= policy.historySec * 1e6 && s.rows.length >= Math.ceil(policy.historySec))) {
      // Spend at most one step of new debt; do not pile steps onto an unfinished recovery.
      for (let candidate = Math.ceil(Math.max(policy.minLeadMs, target - policy.loweringStepMs)); candidate <= target - policy.hysteresisMs; candidate++) {
        const saved = target - candidate;
        if (group.every(s => {
          const cost = elasticCost(s.rows, candidate - policy.hysteresisMs, policy.rampMsPerSec, policy.historySec);
          return s.debtMs <= policy.hysteresisMs && !s.recovering && cost.debtMsPerHour <= policy.debtMsPerHour
            && cost.areaMsSecondsPerHour <= saved * 3600 * policy.debtAreaFraction;
        })) { desired = candidate; why = "elastic debt cost within budget"; break; }
      }
    }
    desired = Math.max(policy.minLeadMs, Math.min(desired, policy.maxLeadMs));
    let command: LeadCommand | null = null;
    // Never replace an epoch that some listeners may already have received.
    if (desired !== target && !pending) {
      const deliveryMs = Math.max(policy.commandAheadMs, ...admitted().flatMap(s => s.rows.map(r => r.deliveryMs)));
      const atServerUs = us + Math.ceil(deliveryMs * 1000);
      pending = { fromMs: effective(atServerUs), leadMs: desired, atServerUs };
      target = desired; changedUs = us;
      command = { type: "lead", leadMs: target, atServerUs };
      decisions.push({ ...command, reason: why, fromMs: pending.fromMs, rampEndUs: atServerUs + Math.abs(target - pending.fromMs) / policy.rampMsPerSec * 1e6 });
    }
    return snapshot(us, decisions, command);
  }
  function observe(id: string, stats: LeadStats, us: number) {
    if (!listeners.has(id)) add(id, us);
    advance(us);
    const s = listeners.get(id)!, needMs = requiredLead(stats), decisions: LeadDecision[] = [];
    if (s.admission === "removed" || needMs === null) return decide(us);
    if (s.observedUs !== undefined && us <= s.observedUs) return snapshot(us);
    // Missing intervals are not evidence that it is safe to lower the group lead.
    if (us - s.lastUs >= policy.staleSec * 1e6) { s.rows = []; s.firstUs = null; }
    s.lastUs = s.observedUs = us;
    s.debtMs = finite(stats.debtMs) ? stats.debtMs : 0;
    s.recovering = !!stats.recovering || (stats.resyncs ?? 0) > 0;
    s.warmFirstUs ??= us;
    if (!s.warmed) {
      s.warmReports++; s.startupNeedMs = Math.max(s.startupNeedMs, needMs);
      if (us - s.warmFirstUs < policy.warmupSec * 1e6 || s.warmReports < Math.ceil(policy.warmupSec)) return decide(us);
      s.warmed = true;
    }
    s.firstUs ??= us;
    const deliveryMs = Math.max(0, finite(stats.arrivalGapMaxMs) ? stats.arrivalGapMaxMs : 0,
      finite(stats.leadMs) && finite(stats.headroomMinMs) ? stats.leadMs - stats.headroomMinMs : 0);
    s.rows.push({ us, needMs, deliveryMs });
    s.rows = s.rows.filter(r => us - r.us <= policy.historySec * 1e6);
    s.needMs = s.rows.length > 1 ? Math.min(needMs, s.rows.at(-2)!.needMs) : needMs;
    if (s.admission === "warming" && s.rows.length >= 2) {
      s.admission = "admitted";
      decisions.push({ type: "admission", id, admission: "admitted", atServerUs: us, reason: "ongoing need measured" });
    }
    return decide(us, decisions);
  }
  return { policy, add, observe,
    // The deadline every packet is held to now, without building a snapshot.
    effectiveLeadMs(us: number) { advance(us); return effective(us); },
    tick(us: number) { advance(us); return decide(us); },
    current(us: number) { advance(us); return snapshot(us); },
    remove(id: string, us: number) { advance(us); listeners.delete(id); return decide(us, [{ type: "leave", id, atServerUs: us }]); },
    drop(id: string, us: number, reason = "Removed by the host") {
      advance(us); const s = listeners.get(id);
      if (!s || s.admission === "removed") return snapshot(us);
      s.admission = "removed"; s.reason = reason;
      return decide(us, [{ type: "drop", id, reason, atServerUs: us }]);
    },
  };
}
