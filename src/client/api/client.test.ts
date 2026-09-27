import { afterEach, expect, spyOn, test } from "bun:test";
import { apiFetch } from "./client";

const credentials = { origin: "http://couch.test", token: "live-token" };
let fetchSpy: ReturnType<typeof spyOn> | undefined;
let timeoutSpy: ReturnType<typeof spyOn> | undefined;
afterEach(() => { fetchSpy?.mockRestore(); timeoutSpy?.mockRestore(); });

for (const cancellation of ["query", "deadline"] as const) test(`an API read responds to ${cancellation} while retaining both cancellation sources`, async () => {
  const query = new AbortController(), deadline = new AbortController();
  timeoutSpy = spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => { expect(milliseconds).toBe(15_000); return deadline.signal; });
  let combined: AbortSignal | null | undefined;
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => {
    combined = init?.signal;
    return new Promise<Response>((_resolve, reject) => combined!.addEventListener("abort", () => reject(combined!.reason), { once: true }));
  }) as typeof fetch);
  const pending = apiFetch(credentials, "/api/library/sources", { signal: query.signal }).catch(error => error);
  (cancellation === "query" ? query : deadline).abort(new Error(cancellation));
  expect(combined?.aborted).toBe(true);
  expect((await pending).message).toBe(cancellation);
});

test("already canceled reads never start a fetch", async () => {
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));
  const controller = new AbortController(); controller.abort(new Error("retired connection"));
  await expect(apiFetch(credentials, "/api/library/sources", { signal: controller.signal })).rejects.toThrow("retired connection");
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("Headers inputs retain custom headers but cannot override the live credential", async () => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    expect(String(input)).toBe("http://couch.test/api/providers/favorites");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer live-token");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Test")).toBe("kept");
    return Response.json({ favorites: [] });
  }) as typeof fetch);
  await apiFetch(credentials, "/api/providers/favorites", { headers: new Headers({ authorization: "Bearer retired-token", "Content-Type": "application/json", "X-Test": "kept" }) });
});

for (const sessionMode of ["personal", "household", undefined] as const) test(`API session scope follows immutable credentials (${sessionMode ?? "legacy"})`, async () => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => {
    expect(new Headers(init?.headers).get("X-Couch-Session")).toBe(sessionMode === "personal" ? "personal" : null);
    return Response.json({});
  }) as typeof fetch);
  await apiFetch({ ...credentials, sessionMode }, "/api/progress/history", { headers: { "X-Couch-Session": "other-controller" } });
});

test("durable playback scope overrides a stale legacy session header", async () => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => {
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Couch-Playback")).toBe("playback-42");
    expect(headers.get("X-Couch-Session")).toBeNull();
    return Response.json({});
  }) as typeof fetch);
  await apiFetch({ ...credentials, playbackId: "playback-42" }, "/api/progress/history", { headers: { "X-Couch-Playback": "retired", "X-Couch-Session": "personal" } });
});
