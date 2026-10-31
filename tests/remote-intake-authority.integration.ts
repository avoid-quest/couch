import assert from "node:assert/strict";
import { test } from "node:test";
import { authorityFixture, resultOk, until } from "./hub-authority.fixture";

for (const guarded of [true, false]) for (const playNow of [false, true]) for (const change of ["selection", "disconnect", "migration", "consent", "unchanged", "explicit"] as const) {
  if (playNow && change === "explicit") continue;
  test(`catalogue preparation retains its original Remote target (${guarded ? "guarded" : "legacy"}, ${playNow ? "play" : "append"}, ${change})`, { timeout: 15_000 }, async t => {
    const f = await authorityFixture(); t.after(() => f.close());
    const phone = await f.connect(), tv = await f.connect(f.devices[2]!, "&tv=1&audio=1&video=1"), other = await f.connect(f.devices[3]!, "&tv=1&audio=1&video=1");
    const source = `${f.hub.origin}/api/health`;
    resultOk(await tv.command({ type: "enqueue", entry: { id: "original", title: "Original", source }, playNow: true }));
    await until(() => tv.messages.some(message => message.type === "player" && message.command.type === "load"));
    tv.report({ status: "paused" });
    await until(() => tv.state.player.status === "paused");
    resultOk(await phone.command({ type: "control", deviceId: tv.id }));
    const entered = Promise.withResolvers<void>(), response = Promise.withResolvers<Response>();
    const localFetch = globalThis.fetch;
    t.mock.method(globalThis, "fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "https://www.raiplay.it/programmi/authority.json") { entered.resolve(); return response.promise; }
      return localFetch(input, init);
    });
    const pending = phone.command({ type: "enqueueProvider", provider: "raiplay", shape: "playlist", url: "https://www.raiplay.it/programmi/authority", playNow, ...(change === "explicit" ? { playNow: true, deviceId: other.id } : {}) }, guarded ? tv.id : undefined);
    await entered.promise;
    if (change === "selection" || change === "explicit") resultOk(await phone.command({ type: "control", deviceId: other.id }));
    if (change === "disconnect") { tv.socket.terminate(); await until(() => phone.state.devices?.find(device => device.id === tv.id)?.online === false); }
    if (change === "migration") {
      resultOk(await tv.command({ type: "solo", deviceId: other.id }));
      await until(() => other.messages.some(message => message.type === "player" && message.command.type === "load"));
      other.report({ status: "paused" });
      await until(() => phone.state.playbacks?.some(playback => playback.outputs.some(output => output.deviceId === other.id) && playback.status === "paused") === true);
    }
    if (change === "consent") resultOk(await tv.command({ type: "sharing", sharing: { audio: false, video: false } }));
    const before = phone.state.playbacks;
    response.resolve(Response.json({ name: "Delayed list", items: [{ name: "Delayed episode", weblink: "/video/2026/10/authority-episode.html" }] }));
    const result = await pending;
    if (change === "unchanged" || change === "explicit") {
      resultOk(result);
      await until(() => phone.state.queue.some(entry => entry.title === "Delayed episode"));
      assert.equal(phone.state.controlling, change === "explicit" ? other.id : tv.id);
      assert.ok(phone.state.outputs?.some(output => output.deviceId === (change === "explicit" ? other.id : tv.id)));
    } else {
      assert.equal(result.ok, false, "stale catalogue intake must reject after the held provider response");
      assert.deepEqual(phone.state.playbacks, before, "a refused completion cannot alter the current output assignments");
      assert.equal(phone.state.queue.some(entry => entry.title === "Delayed episode"), false);
      assert.equal(other.state.queue.some(entry => entry.title === "Delayed episode"), false);
    }
  });
}
