import { expect, mock, test } from "bun:test";
import type { RadioProgramme, SessionState } from "../shared/protocol";
import { createRadioProgramme } from "./radio-programme";

const state = (playbackId = "one", source = "radio:one", status: SessionState["player"]["status"] = "playing"): SessionState => ({
  currentEntryId: "entry", queue: [{ id: "entry", source, title: "Station" }], activeProfile: { id: "household", name: "Household" },
  player: { playbackId, status, position: 0, duration: null, volume: 80, seekable: false, error: null, nowPlaying: { title: "Observed track" } },
});
const payload = (overrides = {}) => ({ ok: true, data: { title: "Programme", streamUrl: "https://stream.example/live", artworkUrl: "https://images.example/programme.jpg", sampledAt: 1000, expiresAt: 901000, ...overrides } });
const tick = () => Bun.sleep(0);

function fixture(request: (url: string, init?: RequestInit) => Promise<Response>) {
  const publish = mock((_playbackId: string, _value: RadioProgramme | null) => {});
  let timer: (() => void) | undefined;
  let delay = 0;
  let time = 1000;
  const watcher = createRadioProgramme({
    station: source => source.startsWith("radio:") ? { id: source.slice(6), streamUrl: "https://stream.example/live" } : null,
    publish, fetch: request as typeof fetch, now: () => time,
    schedule: ((fn: () => void, ms: number) => { timer = fn; delay = ms; return 1; }) as unknown as typeof setTimeout,
    cancel: (() => { timer = undefined; }) as typeof clearTimeout,
  });
  watcher.load("one", "radio:one", "https://stream.example/live");
  return { watcher, publish, delay: () => delay, advance: (ms: number) => { time += ms; const fn = timer; timer = undefined; fn?.(); }, hasTimer: () => !!timer };
}

test("one shared request preserves track text, carries only provider cookie, and drops expired artwork before refreshing", async () => {
  const calls: RequestInit[] = [];
  const f = fixture(async (url, init) => {
    expect(url).toBe("https://radio.avoid.quest/api/radio-metadata?stationId=one");
    calls.push(init!);
    return calls.length === 1 ? Response.json(payload(), { headers: { "Set-Cookie": "radio_session_id=opaque-session; HttpOnly" } }) : new Response(null, { status: 503 });
  });
  const playing = state();
  f.watcher.observe(playing);
  f.watcher.observe(playing);
  await tick();
  expect(calls).toHaveLength(1);
  expect(f.publish.mock.calls[0]?.[1]).toEqual({ playbackId: "one", stationId: "one", provider: "radio.avoid.quest", title: "Programme", artworkUrl: "https://images.example/programme.jpg", sampledAt: 1000, expiresAt: 901000 });
  expect(playing.player.nowPlaying?.title).toBe("Observed track");
  expect(f.delay()).toBe(900000);
  f.advance(900000);
  expect(f.publish.mock.calls.at(-1)?.[1]).toBeNull();
  await tick();
  expect(new Headers(calls[1]?.headers).get("cookie")).toBe("radio_session_id=opaque-session");
  expect(f.delay()).toBe(60000);
  f.watcher.close();
  expect(f.hasTimer()).toBe(false);
});

test("station changes ignore late responses without aborting shared work; stop cancels polling", async () => {
  const pending = Promise.withResolvers<Response>();
  const signals: AbortSignal[] = [];
  const f = fixture(async (_url, init) => { signals.push(init!.signal!); return signals.length === 1 ? pending.promise : Response.json(payload({ title: "Second" })); });
  f.watcher.observe(state());
  f.watcher.load("two", "radio:two", "https://stream.example/live");
  f.watcher.observe(state("two", "radio:two"));
  expect(signals[0]?.aborted).toBe(false);
  await tick();
  pending.resolve(Response.json(payload({ title: "Old" })));
  await tick();
  expect(f.publish.mock.calls.filter(call => call[1]).map(call => call[1]?.title)).toEqual(["Second"]);
  f.watcher.observe(state("two", "radio:two", "idle"));
  expect(f.hasTimer()).toBe(false);
  expect(signals[1]?.aborted).toBe(false);
  f.watcher.close();
});

test("ordinary sources make no requests and provider errors honor retry-after", async () => {
  const request = mock(async () => new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
  const f = fixture(request);
  f.watcher.observe(state("file", "library:music"));
  expect(request).not.toHaveBeenCalled();
  f.watcher.observe(state());
  await tick();
  expect(f.delay()).toBe(120000);
  expect(f.publish).not.toHaveBeenCalled();
  f.watcher.close();
});

test("expired, future and malformed metadata never appears; unsafe or absent artwork still leaves a title", async () => {
  for (const fields of [{ streamUrl: "https://stream.example/changed" }, { expiresAt: 1000 }, { sampledAt: 100000 }, { title: null }, { artworkUrl: "file:///private" }, { artworkUrl: null }]) {
    const f = fixture(async () => Response.json(payload(fields)));
    f.watcher.observe(state());
    await tick();
    if ("artworkUrl" in fields) {
      expect(f.publish.mock.calls[0]?.[1]?.title).toBe("Programme");
      expect(f.publish.mock.calls[0]?.[1]?.artworkUrl).toBeUndefined();
    } else expect(f.publish).not.toHaveBeenCalled();
    f.watcher.close();
  }
});

test("removing the active imported station clears its programme", async () => {
  let available = true;
  const publish = mock((_playbackId: string, _value: RadioProgramme | null) => {});
  const watcher = createRadioProgramme({ station: () => available ? { id: "one", streamUrl: "https://stream.example/live" } : null, publish, fetch: (async () => Response.json(payload())) as unknown as typeof fetch, now: () => 1000 });
  watcher.load("one", "radio:one", "https://stream.example/live");
  watcher.observe(state());
  await tick();
  available = false;
  watcher.observe(state());
  expect(publish.mock.calls.at(-1)).toEqual(["one", null]);
  watcher.close();
});

test("catalog refresh cannot attach a new stream's programme to the old playing stream", async () => {
  let streamUrl = "https://stream.example/live";
  const publish = mock((_playbackId: string, _value: RadioProgramme | null) => {});
  const request = mock(async () => Response.json(payload()));
  const watcher = createRadioProgramme({ station: () => ({ id: "one", streamUrl }), publish, fetch: request as unknown as typeof fetch, now: () => 1000 });
  watcher.load("one", "radio:one", streamUrl);
  watcher.observe(state());
  await tick();
  streamUrl = "https://stream.example/replaced";
  watcher.observe(state());
  expect(publish.mock.calls.at(-1)).toEqual(["one", null]);
  expect(request).toHaveBeenCalledTimes(1);
  watcher.close();
});
