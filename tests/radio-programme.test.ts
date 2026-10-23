import { expect, test } from "bun:test";
import { createRadioProgramme } from "../src/server/radio-programme";
import type { RadioProgramme, SessionState } from "../src/shared/protocol";
import type { RadioProgrammeDetails } from "../src/shared/radio";

const state = (playbackId: string, station: string) => ({ queue: [{ id: "entry", source: `radio:${station}` }], currentEntryId: "entry", player: { playbackId, status: "playing" } }) as SessionState;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test("independent playbacks survive other station switches, discard late results, and clear metadata at expiry", async () => {
  let now = 1000;
  const requests: { id: string; signal?: AbortSignal; resolve: (value: { programme: RadioProgrammeDetails | null; retryAt: number }) => void }[] = [];
  const updates: [string, RadioProgramme | null][] = [];
  const timers = new Map<number, () => void>(); let timerId = 0;
  const tracker = createRadioProgramme({ now: () => now,
    station: source => ({ id: source.slice(6), streamUrl: `https://audio.example/${source.slice(6)}` }),
    publish: (id, show) => updates.push([id, show]),
    metadata: { get: async (id, _url, signal) => new Promise(resolve => requests.push({ id, signal, resolve })) },
    schedule: ((fn: () => void) => { timers.set(++timerId, fn); return timerId; }) as unknown as typeof setTimeout,
    cancel: ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout,
  });
  const load = (target: string, id: string, station: string) => { tracker.load(id, `radio:${station}`, `https://audio.example/${station}`, target); tracker.observe(state(id, station), target); };
  const result = (title: string) => ({ programme: { title, stationId: title, provider: "xmltv", sampledAt: now, expiresAt: now + 1000 } as RadioProgrammeDetails, retryAt: now + 5000 });
  try {
    load("living-room", "p1", "one"); load("bedroom", "p2", "two");
    requests[1]!.resolve(result("two")); await flush();
    load("living-room", "p3", "three");
    expect(requests[0]!.signal?.aborted).toBe(true);
    expect(requests[1]!.signal?.aborted).toBe(false);
    requests[0]!.resolve(result("old")); requests[2]!.resolve(result("three")); await flush();
    expect(updates.filter(([, show]) => show?.title === "old")).toEqual([]);
    expect(updates.some(([id, show]) => id === "p2" && show?.title === "two")).toBe(true);
    expect(updates.some(([id, show]) => id === "p3" && show?.title === "three")).toBe(true);
    now += 1000;
    for (const tick of [...timers.values()]) tick();
    expect(updates.filter(([id, show]) => id === "p2" && show === null)).toHaveLength(1);
    tracker.remove("bedroom");
    requests.at(-2)!.resolve(result("late-two")); await flush();
    expect(updates.some(([, show]) => show?.title === "late-two")).toBe(false);
  } finally { tracker.close(); }
});

test("an obsolete resolved URL never starts metadata for the newly loaded station", async () => {
  let calls = 0;
  const tracker = createRadioProgramme({ station: () => ({ id: "same", streamUrl: "https://audio.example/new" }), publish: () => {}, metadata: { get: async () => { calls++; return { programme: null, retryAt: Date.now() + 60_000 }; } } });
  try { tracker.load("p", "radio:same", "https://audio.example/old"); tracker.observe(state("p", "same")); expect(calls).toBe(0); }
  finally { tracker.close(); }
});
