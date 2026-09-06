import { strict as assert } from "node:assert";
import type { Action, SessionState } from "../../src/shared/protocol";
import type { GuidePage, GuideSource } from "../../src/shared/iptv";
import { assertResponsive, keys, type UiDriver, type Wait, type startHttpRemote } from "./ui";
import { assertNativeVideoPixels } from "./pixels";
import { assertLiveFrame, clockLag } from "./iptv-clock";
import { captureGuideClock } from "./iptv-native-clock";
import { appleGuidePermission, appleGuideSample, type GuideFixture } from "./iptv-fixture";

type Remote = { token: string; state: SessionState | null; command: (action: Action) => Promise<void> };
type HttpRemote = Awaited<ReturnType<typeof startHttpRemote>>;
type Context = { origin: string; ui: UiDriver; httpRemote: HttpRemote; clients: readonly Remote[]; until: Wait; artifactDir: string };

export async function verifyGuide({ origin, ui, httpRemote, clients, until, artifactDir }: Context, fixture: GuideFixture) {
  await fixture.startStreams();
  const first = () => clients[0]!.state!;
  const all = (predicate: (state: SessionState) => boolean) => clients.every(client => !!client.state && predicate(client.state));
  const originalQueue = first().queue.map(entry => entry.id);
  const adminToken: string = await httpRemote.ui.execute("return localStorage.getItem('couch.remote-token')");
  const api = (path: string, method = "GET", body?: unknown, token = adminToken) => fetch(`${origin}/api/iptv/${path}`, { method, headers: { Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const page = async () => (await (await api("guide")).json()) as GuidePage;
  const screenshot = async (name: string) => {
    await ui.execute("document.querySelectorAll('.pairing-display, .pair-shortcut strong').forEach(el => el.style.visibility='hidden')");
    const data = await ui.request(`/session/${ui.session()}/screenshot`);
    await Bun.write(`${artifactDir}/${name}.png`, Buffer.from(data, "base64"));
  };
  const stop = async () => { await clients[0]!.command({ type: "stop" }); await until("IPTV Stop clears the current native load on both controllers", () => all(state => state.player.status === "idle" && state.currentEntryId === null)); };
  const playing = (id: string) => all(state => state.player.status === "playing" && state.player.position > 0.2 && state.queue.find(entry => entry.id === state.currentEntryId)?.source === `iptv:${id}` && state.player.tracks?.some(track => track.kind === "video") === true && state.player.tracks?.some(track => track.kind === "audio") === true);
  const observations: unknown[] = [];
  let previous = "";
  const observe = setInterval(() => {
    const state = first();
    const value = { at: Date.now(), entry: state.currentEntryId, playback: state.player.playbackId, status: state.player.status, second: Math.floor(state.player.position), tracks: state.player.tracks?.map(track => track.kind) };
    const encoded = JSON.stringify({ ...value, at: 0 });
    if (encoded !== previous) { observations.push(value); previous = encoded; }
  }, 100);
  const evidence: Record<string, unknown> = { generated: fixture.hashes, encoding: fixture.encoding, epoch: fixture.epoch, publicSample: { url: appleGuideSample, permission: appleGuidePermission, schedule: "Generated XMLTV, not an Apple program schedule", catchup: "None supplied or tested" } };
  const write = () => Bun.write(`${artifactDir}/iptv.json`, JSON.stringify({ ...evidence, date: new Date().toISOString(), requests: fixture.requests(), observations, limits: "Software rendering and a silent audio sink. No physical audio, decoder, HDMI or network hardware qualification." }, null, 2));
  try {
    await stop();
    assert.equal((await api("sources", "POST", fixture.definition, clients[1]!.token)).status, 403, "An ordinary paired controller cannot import guide URLs");
    assert.equal((await api("sources", "GET", undefined, "")).status, 401, "An unpaired browser cannot read the guide");
    await httpRemote.minimize(); await ui.section("Guide");
    await until("native TV exposes protected guide management", () => ui.execute("return !!document.querySelector('.guide-heading button[data-tv-local-only]')"));
    await ui.button("Guide sources");
    await ui.type("#guide-source-name", "Remote must not import");
    await ui.type("#guide-playlist-url", fixture.definition.playlistUrl);
    await ui.type("#guide-xmltv-url", fixture.definition.guideUrl);
    await ui.execute("document.querySelector('.guide-sources form button[type=submit], .guide-sources form button:not([type])').focus()");
    await clients[1]!.command({ type: "navigate", key: "select" });
    await ui.request(`/session/${ui.session()}/execute/async`, { script: "const done=arguments[arguments.length-1]; requestAnimationFrame(()=>requestAnimationFrame(()=>done(null)))", args: [] });
    assert.equal((await page()).sources.length, 0, "Indirect TV OK cannot submit a physically opened guide-source form");
    await clients[1]!.command({ type: "navigate", key: "back" });
    await until("paired Back dismisses protected guide management", () => ui.execute("return !document.querySelector('.guide-sources')"));
    await httpRemote.restore(); await httpRemote.ui.section("Guide"); await httpRemote.ui.button("Guide sources");
    await httpRemote.ui.type("#guide-source-name", fixture.definition.name);
    await httpRemote.ui.type("#guide-playlist-url", fixture.definition.playlistUrl);
    await httpRemote.ui.type("#guide-xmltv-url", fixture.definition.guideUrl);
    await assertResponsive(httpRemote.ui, "Phone IPTV administrator import");
    await httpRemote.screenshot("http-iptv-import");
    await httpRemote.ui.button("Import guide");
    let saved!: GuideSource;
    await until("administrator phone imports four channels and generated XMLTV programs", async () => { saved = (await page()).sources[0]!; return saved?.channelCount === 4 && saved.programCount === 768; });
    await httpRemote.ui.key(keys.escape);
    await until("TV and phone guide show exact now/next mapping and numeric XML entities", async () => (await page()).channels.every(channel => channel.now?.title.includes("café é") && channel.next) && await ui.execute("return document.querySelector('.guide-now-next')?.textContent.includes('café é')") && await httpRemote.ui.execute("return document.querySelector('.guide-now-next')?.textContent.includes('café é')"));
    const channels = (await page()).channels;
    const red = channels.find(channel => channel.tvgId === "red")!, blue = channels.find(channel => channel.tvgId === "blue")!, slow = channels.find(channel => channel.tvgId === "slow")!, apple = channels.find(channel => channel.tvgId === "apple")!;
    await until("TV and phone decode channel logos through private host URLs", async () => await ui.execute("return [...document.querySelectorAll('.guide-logo img')].filter(img=>img.complete&&img.naturalWidth===32).length===4") && await httpRemote.ui.execute("return [...document.querySelectorAll('.guide-logo img')].filter(img=>img.complete&&img.naturalWidth===32).length===4"));
    await assertResponsive(httpRemote.ui, "Phone IPTV now and next"); await httpRemote.screenshot("http-iptv-guide");
    await httpRemote.ui.button("Programs", `[data-channel-id="${red.id}"]`);
    await until("HTTP phone opens a full day of cached programs", () => httpRemote.ui.execute("return document.querySelectorAll('.guide-program-list li').length>=23"));
    await assertResponsive(httpRemote.ui, "Phone IPTV program list"); await httpRemote.screenshot("http-iptv-programs");
    await httpRemote.ui.button("Next day");
    await until("HTTP phone browses tomorrow without changing native guide selection", () => httpRemote.ui.execute("return document.querySelectorAll('.guide-program-list li').length>=23"));
    await httpRemote.ui.key(keys.escape);
    await until("program dialog restores focus to its real Programs button", () => httpRemote.ui.execute("return !document.querySelector('.guide-program-dialog') && document.activeElement?.textContent==='Programs'"));
    await httpRemote.ui.type("#guide-search", "Blue");
    await until("phone channel search remains device-local", async () => await httpRemote.ui.execute("return document.querySelectorAll('.guide-channel').length===1") && await ui.execute("return document.querySelectorAll('.guide-channel').length===4"));
    await httpRemote.ui.type("#guide-search", "");
    await httpRemote.minimize(); await ui.section("Guide"); await screenshot("native-iptv-guide");
    await ui.execute("window.__iptvStage=document.querySelector('.video-stage')");
    await ui.button(`Play ${red.name}`);
    await until("TV Guide Play loads actual generated red HLS audio and video on both controllers", () => playing(red.id), 25_000);
    await assertNativeVideoPixels(ui.execute, artifactDir, "native-iptv-red", [253, 0, 0]);
    await httpRemote.restore(); await httpRemote.ui.button(`Play ${blue.name}`);
    await until("phone channel switch loads actual blue HLS on the same native player", () => playing(blue.id), 25_000);
    await httpRemote.minimize(); await assertNativeVideoPixels(ui.execute, artifactDir, "native-iptv-blue", [0, 0, 254]);
    assert.equal(await ui.execute("return window.__iptvStage===document.querySelector('.video-stage')"), true, "Channel switches preserve the mounted native VideoStage");
    await clients[0]!.command({ type: "pause", playbackId: first().player.playbackId!, paused: true });
    await until("live HLS pauses on both controllers", () => all(state => state.player.status === "paused"));
    const beforeLive = await fixture.currentSequence(), oldPlayback = first().player.playbackId;
    await until("the live fixture advances at least eight segments while paused", async () => await fixture.currentSequence() >= beforeLive + 8, 20_000);
    await httpRemote.restore(); await httpRemote.ui.section("Guide");
    await until("probed live HLS exposes the Go live action", () => httpRemote.ui.execute("return [...document.querySelectorAll('.guide-channel-actions button')].some(button=>button.textContent==='Go live')"));
    const starts: unknown[] = []; evidence.liveStarts = starts;
    const reload = async () => {
      const old = first().player.playbackId;
      await httpRemote.restore(); await httpRemote.ui.section("Guide");
      const at = Date.now(), boundary = fixture.requests().length;
      const start: Record<string, unknown> = { at, oldPlayback: old, boundary }; starts.push(start);
      await httpRemote.ui.button("Go live");
      await write();
      await until("Go live starts a new native load of the live channel", () => playing(blue.id) && first().player.playbackId !== old, 25_000);
      await httpRemote.minimize();
      const requests = fixture.requests().slice(boundary);
      const probes = requests.filter(request => !request.native && request.path === "/blue/live.m3u8");
      const native = requests.filter(request => request.native && request.path.startsWith("/blue/") && request.at >= (probes[0]?.servedAt ?? Infinity));
      const manifest = native[0], segment = native[1];
      Object.assign(start, { playbackId: first().player.playbackId, probes, requests, manifest, segment }); await write();
      assert.equal(probes.length, 1, "Explicit Go live has one fresh host eligibility probe after its action boundary");
      assert.ok(manifest?.sequences?.length && segment?.sequence !== undefined, "The fresh probe is followed by an unambiguous native manifest and first segment");
      assert.equal(segment.sequence, manifest.sequences.at(-1), "Explicit Go live starts at the newest complete advertised segment");
    };
    const captures: Record<string, Awaited<ReturnType<typeof captureGuideClock>>[]> = {}; evidence.captures = captures;
    const capture = async (name: string, suffix: string) => {
      const frame = await captureGuideClock(ui, artifactDir, `${name}-${suffix}`, fixture.epoch);
      (captures[name] ??= []).push(frame); await write();
      return frame;
    };
    const frames = async (name: string) => {
      const first = await capture(name, "first");
      await Bun.sleep(1_000);
      const second = await capture(name, "second");
      assert.ok(second.tick > first.tick && second.captureStart > first.captureEnd, "Native presented frames and fixture clock both advance between captures");
      return [first, second];
    };
    const resumedAt = Date.now(); await reload();
    const liveFrames = await frames("native-iptv-live");
    evidence.liveEdge = { beforeLive, oldPlayback, resumedAt, playbackId: first().player.playbackId, frames: liveFrames.map(frame => ({ ...frame, ...assertLiveFrame(frame) })) };
    await until("fixture retains a complete delayed live window", async () => await fixture.currentSequence() >= 18, 40_000);
    try {
      fixture.delayLive(20); await reload();
      const delayedFrames = await frames("native-iptv-delayed-reload");
      for (const frame of delayedFrames) {
        const lag = clockLag(frame); // Invalid capture/clock/marker errors cannot count as the negative control.
        assert.ok(lag.minimumLagMs >= 20_000, "Deliberately delayed native frames are at least twenty seconds old");
        assert.throws(() => assertLiveFrame(frame), /Presented IPTV frame exceeds/, "The same live assertion rejects a new load presenting delayed video");
      }
      evidence.liveNegativeControl = { delaySeconds: 20, playbackId: first().player.playbackId, frames: delayedFrames.map(frame => ({ ...frame, ...clockLag(frame) })) };
    } finally { fixture.delayLive(0); }
    await reload();
    evidence.liveRecovery = (await frames("native-iptv-live-recovery")).map(frame => ({ ...frame, ...assertLiveFrame(frame) }));

    const steady = await fixture.currentSequence();
    await until("fresh native playback crosses three more published segments before the delivery stall", async () => playing(blue.id) && await fixture.currentSequence() >= steady + 3, 20_000);
    const stalledPlayback = first().player.playbackId;
    const hold = fixture.holdNextSegment();
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    let stalledFrames: Awaited<ReturnType<typeof captureGuideClock>>[] = [];
    const stall: Record<string, unknown> = { playbackId: stalledPlayback, holdMs: 12_000, recoveryLimitMs: 25_000 }; evidence.liveStall = stall;
    try {
      await until("native playback requests the held future blue segment", () => !!hold.request?.heldAt, 20_000);
      const heldAt = hold.request!.heldAt!; stall.request = hold.request; await write();
      releaseTimer = setTimeout(() => hold.release(), Math.max(0, heldAt + 12_000 - Date.now()));
      await Bun.sleep(Math.max(0, heldAt + 8_000 - Date.now()));
      const firstStalled = await capture("native-iptv-stalled", "first");
      await Bun.sleep(1_000);
      const secondStalled = await capture("native-iptv-stalled", "second");
      stalledFrames = [firstStalled, secondStalled]; stall.frames = stalledFrames; await write();
      await Bun.sleep(Math.max(0, heldAt + 12_000 - Date.now()));
    } finally {
      if (releaseTimer) clearTimeout(releaseTimer);
      hold.release(); stall.request = hold.request; await write();
    }
    assert.ok(!hold.request!.aborted && hold.request!.releasedAt! - hold.request!.heldAt! >= 12_000, "Native segment delivery remains held for the complete twelve-second fault");
    assert.equal(stalledFrames[0]!.tick, stalledFrames[1]!.tick, "The bounded delivery hold actually stalls presented video");
    assert.equal(first().player.playbackId, stalledPlayback, "A delivery stall preserves current playback authority");
    const releasedAt = hold.request!.releasedAt!, stalledPosition = first().player.position;
    await until("the same native load resumes after held segment delivery", () => playing(blue.id) && first().player.playbackId === stalledPlayback && first().player.position > stalledPosition + 1, 25_000);
    const recovered = await frames("native-iptv-stall-resumed");
    stall.recovered = recovered; await write();
    assert.ok(recovered[0]!.tick > stalledFrames[1]!.tick && recovered[1]!.captureEnd - releasedAt <= 25_000, "The same stalled load resumes advancing pixels within twenty-five seconds");
    await reload();
    evidence.liveStallRecovery = (await frames("native-iptv-stall-live-recovery")).map(frame => ({ ...frame, ...assertLiveFrame(frame) }));

    for (const control of ["stop", "replacement"] as const) {
      await api(`channels/${blue.id}/play`, "POST");
      await until("blue channel plays before held-segment cancellation", () => playing(blue.id), 25_000);
      const pending = fixture.holdNextSegment(), old = first().player.playbackId;
      try {
        await until("native segment is pending before a newer control", () => !!pending.request?.heldAt, 20_000);
        if (control === "stop") await stop();
        else {
          await api(`channels/${red.id}/play`, "POST");
          await until("replacement red channel owns native playback", () => playing(red.id) && first().player.playbackId !== old, 25_000);
        }
      } finally { pending.release(); evidence[`heldSegment${control}`] = pending.request; await write(); }
      await Bun.sleep(600);
      assert.ok(control === "stop" ? all(state => state.currentEntryId === null) : playing(red.id) && first().player.playbackId !== old, "Late segment delivery cannot defeat Stop or newer playback");
    }

    const startSlow = async () => {
      const at = Date.now();
      assert.equal((await api(`channels/${slow.id}/play`, "POST", undefined, clients[1]!.token)).status, 200);
      await until("native player has a real outstanding HTTP request for the delayed channel", () => all(state => state.player.status === "loading") && fixture.requests().some(request => request.native && request.path === "/slow.m3u8" && request.at >= at));
      return first().player.playbackId;
    };
    await startSlow(); await stop(); fixture.releaseSlow();
    await Bun.sleep(600); assert.ok(all(state => state.currentEntryId === null), "Late HTTP reply cannot restart a stopped native channel");
    await startSlow();
    await api(`channels/${blue.id}/play`, "POST", undefined, clients[0]!.token); fixture.releaseSlow();
    await until("newer rapid channel Play cancels a delayed native HTTP load", () => playing(blue.id), 25_000);
    const changedPlayback = first().player.playbackId;
    await Bun.sleep(600); assert.equal(first().player.playbackId, changedPlayback, "An old delayed stream cannot replace the newer channel");
    await startSlow(); fixture.replaceSlow();
    assert.equal((await api(`sources/${saved.id}/refresh`, "POST")).status, 200);
    await until("URL replacement cancels an older native channel while it is loading", () => all(state => state.player.status === "idle" && state.currentEntryId === null));
    fixture.releaseSlow(); await Bun.sleep(600);
    await api(`channels/${slow.id}/play`, "POST", undefined, clients[1]!.token);
    await until("the same channel identity resolves its newly committed stream URL", () => playing(slow.id), 25_000);
    fixture.resetSlow(); await api(`sources/${saved.id}/refresh`, "POST"); await stop();
    await startSlow(); assert.equal((await api(`sources/${saved.id}`, "DELETE")).status, 204);
    await until("source removal cancels its native loading channel", () => all(state => state.player.status === "idle" && state.currentEntryId === null));
    fixture.releaseSlow(); await Bun.sleep(600); assert.ok(all(state => state.currentEntryId === null));

    const reimport = await api("sources", "POST", fixture.definition); assert.equal(reimport.status, 201);
    saved = (await reimport.json() as { source: GuideSource }).source;
    const publicChannel = (await page()).channels.find(channel => channel.tvgId === "apple")!;
    await httpRemote.restore();
    await httpRemote.ui.section("Guide");
    await until("reimported public test channel reaches the phone", () => httpRemote.ui.execute("return !!document.querySelector(arguments[0])", [`[data-channel-id="${publicChannel.id}"]`]));
    await httpRemote.ui.button(`Play ${apple.name}`);
    await until("official authorized Apple Bip Bop sample plays native audio and video through the guide", () => playing(publicChannel.id) && first().player.position > 3, 45_000);
    evidence.publicObserved = { playback: first().player, channel: publicChannel, testedAt: new Date().toISOString() };
    await httpRemote.minimize(); await screenshot("native-iptv-apple-sample"); await stop();
    fixture.update(); assert.equal((await api(`sources/${saved.id}/refresh`, "POST")).status, 200);
    const cached = (await page()).channels;
    assert.ok(cached.every(channel => channel.now?.title.includes("updated")));
    fixture.failed = true; assert.equal((await api(`sources/${saved.id}/refresh`, "POST")).status, 502);
    assert.deepEqual((await page()).channels, cached, "Failed refresh keeps channels and programs together");
    await httpRemote.restore(); await httpRemote.refresh(); await httpRemote.ui.section("Guide");
    await until("actual HTTP reconnect receives the persisted offline guide", () => httpRemote.ui.execute("return document.querySelectorAll('.guide-channel').length===4 && document.querySelector('.guide-now-next')?.textContent.includes('updated')"));
    for (const entry of first().queue.filter(entry => !originalQueue.includes(entry.id))) await clients[0]!.command({ type: "remove", entryId: entry.id });
    await stop();
    assert.deepEqual(first().queue.map(entry => entry.id), originalQueue, "IPTV qualification restores the existing queue");
    for (const client of clients) {
      const identity = await (await fetch(`${origin}/api/controllers/me`, { headers: { Origin: origin, Authorization: `Bearer ${client.token}` } })).json() as { authority: string };
      assert.equal(identity.authority, "controller", "Both existing WebSocket remotes remain ordinary controllers");
    }
    await httpRemote.ui.section("Queue"); await httpRemote.minimize(); await ui.section("Queue");
    evidence.source = saved; evidence.completeBeforeRestart = true;
    return { verifyAfterRestart: async (nextClients: readonly Remote[], remote: HttpRemote) => {
      await until("IPTV restart stays stopped for both existing controllers", () => nextClients.every(client => client.state?.player.status === "idle" && client.state.currentEntryId === null));
      assert.deepEqual((await page()).channels, cached, "Restart restores the cached guide while its upstream is offline");
      await remote.restore(); await remote.ui.section("Guide");
      await until("reconnected administrator phone shows saved guide programs after native restart", () => remote.ui.execute("return document.querySelectorAll('.guide-channel').length===4 && document.querySelector('.guide-now-next')?.textContent.includes('updated')"));
      await remote.screenshot("http-iptv-offline-restart");
      await remote.ui.section("Queue"); await remote.minimize();
      evidence.restart = true; await write();
    } };
  } catch (error) { evidence.failure = error instanceof Error ? error.message : String(error); throw error; } finally { clearInterval(observe); await write(); }
}
