import { expect, spyOn, test } from "bun:test";
import { waitForRestart } from "./restart-request";

test("restart requires a different authenticated coordinator identity", async () => {
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ instanceId: "replacement", ready: true }));
  try {
    await expect(waitForRestart("http://fixture/restart", { Authorization: "Bearer fixture" }, "original", new AbortController().signal, 5)).resolves.toBeUndefined();
    expect(fetch.mock.calls[0]![1]!.headers).toEqual({ Authorization: "Bearer fixture" });
  } finally { fetch.mockRestore(); }
});

test("exhausted restart budget or unchanged owner produces operator recovery, never false success", async () => {
  for (const response of [null, Response.json({ instanceId: "replacement", ready: false }), Response.json({ instanceId: "original", ready: true }), Response.json({}), new Response(null, { status: 401 })]) {
    const fetch = spyOn(globalThis, "fetch");
    if (response) fetch.mockResolvedValue(response); else fetch.mockRejectedValue(new Error("Service stopped"));
    try { await expect(waitForRestart("http://fixture/restart", {}, "original", new AbortController().signal, 5)).rejects.toThrow("Couch did not reconnect. Inspect couch-tv.service through SSH"); }
    finally { fetch.mockRestore(); }
  }
});
