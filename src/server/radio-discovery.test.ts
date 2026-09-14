import { afterEach, beforeEach, expect, jest, mock, spyOn, test } from "bun:test";
import { avoidRadioPlaylistUrl } from "../shared/radio";
import { createRadio } from "./radio";
import { createRadioSettings } from "./radio-settings";

const feed = `#EXTM3U\n${Array.from({ length: 50 }, (_, index) => `#EXTINF:-1 tvg-id="station-${index}",Station ${index}\nhttps://stream.example/${index}\n`).join("")}`;
const payload = () => ({ ok: true, data: { streamUrl: "https://stream.example/0", title: "Current programme", sampledAt: Date.now(), expiresAt: Date.now() + 60_000 } });
const radios: ReturnType<typeof createRadio>[] = [];
let timeout: ReturnType<typeof spyOn>;
beforeEach(() => {
  jest.useFakeTimers();
  timeout = spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
    return controller.signal;
  });
});
afterEach(() => {
  for (const radio of radios.splice(0)) radio.close();
  timeout.mockRestore();
  jest.useRealTimers();
});
const fixture = (request: (url: string, init?: RequestInit) => Promise<Response>) => {
  const radio = createRadio({ databasePath: ":memory:", fetch: request as unknown as typeof fetch });
  radios.push(radio);
  return radio;
};

test("a stalled 50-station catalog returns partial programmes within 30s including feed loading", async () => {
  const batches = Array.from({ length: 3 }, () => Promise.withResolvers<void>());
  const calls: AbortSignal[] = [];
  let active = 0;
  let maximum = 0;
  const radio = fixture(async (url, init) => {
    if (url === avoidRadioPlaylistUrl) return new Promise(resolve => setTimeout(() => resolve(new Response(feed)), 9_000));
    const signal = init!.signal!;
    calls.push(signal);
    maximum = Math.max(maximum, ++active);
    if (calls.length % 3 === 0) batches[calls.length / 3 - 1]?.resolve();
    if (new URL(url).searchParams.get("stationId") === "station-0") { active--; return Response.json(payload()); }
    return new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => { active--; reject(signal.reason); }, { once: true }));
  });
  const result = radio.avoidProgrammes();
  jest.advanceTimersByTime(9_000);
  await batches[0]!.promise;
  for (const batch of [1, 2]) { jest.advanceTimersByTime(10_000); await batches[batch]!.promise; }
  jest.advanceTimersByTime(1_000);
  const programmes = await result;
  const first = radio.playlistStations({ playlistId: (await radio.avoid()).playlist.id })[0]!;
  expect(programmes).toEqual({ [first.id]: expect.objectContaining({ title: "Current programme" }) });
  expect(calls).toHaveLength(9);
  expect(maximum).toBe(3);
  expect(calls.slice(-3).every(signal => !signal.aborted)).toBe(true);
  jest.advanceTimersByTime(10_000);
  expect(calls).toHaveLength(9);
});

test("canceling the HTTP discovery request stops new batches while playback shares its pending fetch", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<Response>();
  const calls: AbortSignal[] = [];
  const radio = fixture(async (url, init) => {
    if (url === avoidRadioPlaylistUrl) return new Response(feed);
    calls.push(init!.signal!);
    if (calls.length === 3) started.resolve();
    return new URL(url).searchParams.get("stationId") === "station-0" ? release.promise : new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
    });
  });
  const caller = new AbortController();
  const response = createRadioSettings(radio).handle(new Request("http://localhost/api/radio/avoid/programmes", { signal: caller.signal }),
    () => ({ authority: "controller", controller: null, claimAvailable: false }));
  await started.promise;
  const playing = radio.metadata.get("station-0", "https://stream.example/0");
  caller.abort();
  expect(await (await response).json()).toEqual({ programmes: {} });
  expect(calls).toHaveLength(3);
  expect(calls.every(signal => !signal.aborted)).toBe(true);
  release.resolve(Response.json(payload()));
  expect((await playing).programme?.title).toBe("Current programme");
  expect((await radio.metadata.get("station-0", "https://stream.example/0")).programme?.title).toBe("Current programme");
  jest.advanceTimersByTime(10_000);
  expect(calls).toHaveLength(3);
});

test("canceling while the catalog loads returns promptly and preserves its shared refresh", async () => {
  const release = Promise.withResolvers<Response>();
  const request = mock(async () => release.promise);
  const radio = fixture(request);
  const caller = new AbortController();
  const discovery = radio.avoidProgrammes(caller.signal);
  const browsing = radio.avoid();
  caller.abort();
  expect(await discovery).toEqual({});
  release.resolve(new Response(feed));
  expect((await browsing).stations).toHaveLength(50);
  expect(request).toHaveBeenCalledTimes(1);
  expect((await radio.avoid()).stations).toHaveLength(50);
  expect(request).toHaveBeenCalledTimes(1);
});
