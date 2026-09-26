import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import type { ReplayGainMode, SessionState } from "../../src/shared/protocol";
import type { WatchingProfile } from "../../src/shared/library";
import type { MusicContext } from "./music";
import { analyzeReplayGain } from "./replaygain-audio";
import { assertResponsive, keys, type UiDriver } from "./ui";

type Context = MusicContext & { otherRemote: MusicContext["httpRemote"] & { refresh: () => Promise<unknown> }; screenshot: (name: string) => Promise<void> };
type Fixture = { name: string; file: string; reference: string; expectedDb: Record<ReplayGainMode, number>; sha256: string };

async function output(args: string[]) {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "inherit", timeout: 15_000, killSignal: "SIGKILL" });
  const [code, bytes] = await Promise.all([child.exited, new Response(child.stdout).arrayBuffer()]);
  assert.equal(code, 0, `${args[0]} completes`);
  return bytes;
}

export async function verifyReplayGain(context: Context) {
  const { clients, until, ui, httpRemote, otherRemote, artifactDir, api } = context;
  const first = () => clients[0]!.state!;
  const all = (predicate: (state: SessionState) => boolean) => clients.every(client => client.state && predicate(client.state));
  const original = structuredClone({ profile: first().activeProfile, preferences: first().preferences!, volume: first().player.volume });
  const manifest = await Bun.file("/replaygain-fixtures/manifest.json").json();
  const fixtures = manifest.fixtures as Fixture[];
  const versions = Buffer.from(await output(["dpkg-query", "--show", "libmpv2", "ffmpeg"])).toString();
  await Bun.write(`${artifactDir}/replaygain-versions.txt`, versions);
  assert.ok(/^libmpv2(?::[a-z0-9-]+)?\s+0\.37\./m.test(versions), "Capture expectations explicitly target Ubuntu mpv 0.37");
  await Bun.write(`${artifactDir}/replaygain-fixtures.json`, JSON.stringify(manifest, null, 2));
  const ids: string[] = [];
  const captures: unknown[] = [];
  const stop = async () => {
    await clients[0]!.command({ type: "stop" });
    await until("ReplayGain stops without restarting on either controller", () => all(state => state.player.status === "idle" && state.player.playbackId === null));
  };
  const enqueue = async (fixture: Fixture, radio = false) => {
    const id = crypto.randomUUID(); ids.push(id);
    await clients[0]!.command({ type: "enqueue", entry: { id, title: `ReplayGain ${fixture.name}${radio ? " radio" : ""}`, source: `http://127.0.0.1:4200/replaygain/${fixture.file}`, ...(radio ? { kind: "radio" as const } : {}) } });
    return id;
  };
  const play = async (id: string, requiresPosition = true) => {
    const previous = first().player.playbackId;
    await clients[0]!.command({ type: "play", entryId: id, fromStart: true });
    await until("ReplayGain fixture starts in the actual native player", () => all(state => state.currentEntryId === id && state.player.playbackId !== previous && state.player.status === "playing" && (!requiresPosition || state.player.position > 0)), 15_000);
  };
  const close = async (driver: UiDriver) => {
    if (await driver.execute("return !!document.querySelector('[role=dialog]')")) await driver.key(keys.escape);
    else await driver.section("Saved");
    await until("ReplayGain dialog closes", () => driver.execute("return !document.querySelector('[role=dialog]')"));
  };
  const savedSettings = async (driver: UiDriver) => {
    await driver.button("Settings");
    await driver.settingsSection("playback");
    await until("saved ReplayGain selector is visible", () => driver.execute("return !!document.querySelector('#preferred-replaygain')"));
  };
  const capture = async (fixture: Fixture, id: string, mode: ReplayGainMode, label: string, radio = false, current = false) => {
    const before = structuredClone({ playbackId: first().player.playbackId, mode: first().player.replayGain, preferences: first().preferences });
    if (current) {
      assert.ok(before.playbackId && before.mode !== mode && first().player.status === "paused", "Current-mode measurement starts with a different observed mode on the paused item");
      await clients[0]!.command({ type: "seek", playbackId: before.playbackId, position: 0 });
      await until("current-mode reference starts at zero without replacing playback", () => all(state => state.player.playbackId === before.playbackId && state.player.position < 0.1));
    } else {
      await stop();
      await clients[0]!.command({ type: "preferences", profileId: first().activeProfile.id, preferences: { replayGain: mode, speed: 1 } });
    }
    const previousSink = Buffer.from(await output(["pactl", "get-default-sink"])).toString().trim();
    const sinkInputs = async (): Promise<{ index: number; sink: number }[]> => JSON.parse(Buffer.from(await output(["pactl", "--format=json", "list", "sink-inputs"])).toString());
    const previousInputs = await sinkInputs();
    const path = `${artifactDir}/replaygain-${label}.wav`, log = `${artifactDir}/replaygain-${label}.log`;
    const recorder = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "info", "-y", "-f", "pulse", "-sample_rate", String(manifest.sampleRate), "-channels", "2", "-c:a", "pcm_f32le", "-i", "couch-replaygain.monitor", "-t", "5", "-af", "pan=mono|c0=c0,asetpts=N/SR/TB", "-c:a", "pcm_f32le", path], { stdout: "ignore", stderr: Bun.file(log), timeout: 25_000, killSignal: "SIGKILL" });
    try {
      await api("/api/sound/output", { output: "couch-replaygain" });
      await until("float audio capture is running before Play", async () => await Bun.file(log).exists() && (await Bun.file(log).text()).includes("Output #0"));
      const input = (await Bun.file(log).text()).split("Output #0")[0]!;
      assert.match(input, /Input #0, pulse,[\s\S]*Audio: pcm_f32le[^\n]*48000 Hz[^\n]*(?:stereo|2 channels)[^\n]*flt/, "Pulse input negotiates float32 before output conversion");
      const sinks = Buffer.from(await output(["pactl", "list", "short", "sinks"])).toString();
      assert.match(sinks, /\bcouch-replaygain\s+[^\n]*float32le 2ch 48000Hz/, "Pulse sink retains float32 samples at the reference rate");
      await Bun.write(`${artifactDir}/replaygain-${label}-sinks.txt`, sinks);
      if (current) {
        await clients[0]!.command({ type: "replayGain", playbackId: before.playbackId!, mode });
        await until("current mode changes on both controllers without reloading or saving", () => all(state => state.player.playbackId === before.playbackId && state.player.replayGain === mode && JSON.stringify(state.preferences) === JSON.stringify(before.preferences)));
        await clients[0]!.command({ type: "pause", playbackId: before.playbackId!, paused: false });
      } else await play(id, !radio);
      const dedicatedSink = Number(sinks.split("\n").find(line => line.split("\t")[1] === "couch-replaygain")!.split("\t")[0]);
      let routedInputs = await sinkInputs();
      await until("Actual native output is routed into the dedicated captured sink", async () => {
        routedInputs = await sinkInputs();
        return routedInputs.length > 0 && routedInputs.every(input => input.sink === dedicatedSink);
      });
      await Bun.write(`${artifactDir}/replaygain-${label}-routing.json`, JSON.stringify({ previousSink, previousInputs, routedInputs }, null, 2));
      const excluded = radio || fixture.name === "video" || fixture.name === "r128-overflow";
      await until("native ReplayGain mode matches music eligibility on both controllers", () => all(state => excluded ? state.player.replayGain === undefined : state.player.replayGain === mode));
      const player = structuredClone(first().player);
      assert.equal(await recorder.exited, 0, "Actual Couch audio recording completes");
      if (current) assert.ok(all(state => state.player.playbackId === before.playbackId && state.player.replayGain === mode && JSON.stringify(state.preferences) === JSON.stringify(before.preferences)), "Measured current gain keeps the playback ID and saved default unchanged");
      const recording = JSON.parse(Buffer.from(await output(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels,codec_name", "-of", "json", path])).toString()).streams[0];
      assert.deepEqual(recording, { codec_name: "pcm_f32le", sample_rate: String(manifest.sampleRate), channels: 1 }, "Actual capture preserves float samples at the reference rate");
      const captured = new Float32Array(await output(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path, "-f", "f32le", "-ar", String(manifest.sampleRate), "-ac", "1", "-"]));
      assert.ok(captured.length >= manifest.sampleRate * 4.5 && captured.length <= manifest.sampleRate * 5.1, "Actual capture contains approximately five seconds of audio");
      assert.ok(captured.every(Number.isFinite), "Malformed gain tags never produce nonfinite captured samples");
      const pcm = new Int16Array(await Bun.file(`/replaygain-fixtures/${fixture.reference}.s16le`).arrayBuffer());
      const reference = Float64Array.from(pcm, value => value / 32768);
      const measured = analyzeReplayGain(reference, captured, manifest.sampleRate);
      const expected = radio ? 0 : fixture.expectedDb[mode];
      assert.ok(Math.abs(measured.gainDb - expected) < 0.15, `${label}: measured ${measured.gainDb.toFixed(3)} dB, expected ${expected.toFixed(3)} dB`);
      if (fixture.name !== "r128-missing-peak" || mode === "off") {
        assert.ok(measured.peak <= 1.0001, `${label}: supported peak policy stays within nominal full scale`);
        assert.ok(measured.residualRms < 0.003, `${label}: captured waveform retains its reference shape`);
      } else assert.ok(measured.aboveFullScaleSamples > 0 || measured.nearFullScaleSamples > measured.samples / 10, "R128 missing peak demonstrates the native clipping-policy limit");
      captures.push({ label, fixture: fixture.file, fixtureSha256: fixture.sha256, mode, radio, currentTransition: current ? before : null, player, captureSha256: createHash("sha256").update(Buffer.from(await Bun.file(path).arrayBuffer())).digest("hex"), ...measured });
      await Bun.write(`${artifactDir}/replaygain-captures.json`, JSON.stringify({ versions, captures, physicalOutputQualified: false }, null, 2));
    } finally {
      if (recorder.exitCode === null) { recorder.kill("SIGKILL"); await recorder.exited; }
      try { await stop(); } finally {
        await api("/api/sound/output", { output: previousSink });
        assert.equal(Buffer.from(await output(["pactl", "get-default-sink"])).toString().trim(), previousSink, "Capture restores the original PulseAudio default");
        await Bun.write(`${artifactDir}/replaygain-${label}-restored-routing.json`, JSON.stringify({ defaultSink: previousSink, sinkInputs: await sinkInputs() }, null, 2));
      }
    }
  };
  await stop();
  const profile = (await api("/api/profiles", { name: "ReplayGain verification" }, 1)).profile as WatchingProfile;
  await api(`/api/profiles/${profile.id}/select`, {}, 1);
  await until("ReplayGain has one separate saved-profile owner", () => all(state => state.activeProfile.id === profile.id));
  const entries = new Map<string, string>();
  try {
    for (const fixture of fixtures) entries.set(fixture.name, await enqueue(fixture));
    const tagged = fixtures.find(fixture => fixture.name === "tagged")!;
    const taggedId = entries.get("tagged")!;
    await clients[0]!.command({ type: "volume", volume: 100 });
    await play(taggedId);
    await clients[0]!.command({ type: "audioDelay", playbackId: first().player.playbackId!, delay: 0 });
    await clients[0]!.command({ type: "pause", playbackId: first().player.playbackId!, paused: true });
    await until("music pauses for native and real HTTP ReplayGain controls", () => all(state => state.player.status === "paused" && state.player.replayGain === "off" && state.player.volume === 100 && state.player.audioDelay === 0));
    const playbackId = first().player.playbackId;
    await httpRemote.minimize(); await otherRemote.minimize();
    await ui.controls();
    await ui.button("Settings", "[data-player-tools]");
    await ui.button("Track", "[data-player-sheet]");
    await until("TV current ReplayGain changes only the paused item", () => all(state => state.player.replayGain === "track" && state.preferences?.profile.replayGain === "off" && state.player.playbackId === playbackId));
    assert.deepEqual(await ui.execute("return [innerWidth, innerHeight, devicePixelRatio]"), [1600, 1000, 1]);
    await context.screenshot("replaygain-native-1600x1000");
    await close(ui);
    await httpRemote.restore();
    await httpRemote.ui.section("Now");
    await httpRemote.ui.button("Settings", "[data-player-tools]");
    await httpRemote.ui.button("Album", "[data-player-sheet]");
    await until("first real HTTP browser changes native gain without changing the saved profile", () => all(state => state.player.replayGain === "album" && state.preferences?.profile.replayGain === "off"));
    await httpRemote.ui.button("Save volume leveling as default");
    await until("explicit Save as default commits observed Album", () => all(state => state.preferences?.profile.replayGain === "album" && state.player.replayGain === "album"));
    await httpRemote.screenshot("replaygain-first-http-current");
    await close(httpRemote.ui);
    await httpRemote.minimize(); await otherRemote.restore();
    await otherRemote.ui.section("Saved");
    await savedSettings(otherRemote.ui);
    await otherRemote.ui.select("#preferred-replaygain", "Off");
    await otherRemote.ui.button("Save preferences", 'section[aria-label="Settings"]');
    await until("second real HTTP browser saves the next-item default without changing current Album", () => all(state => state.preferences?.profile.replayGain === "off" && state.player.replayGain === "album" && state.player.playbackId === playbackId));
    await otherRemote.screenshot("replaygain-second-http-default");
    await close(otherRemote.ui);
    assert.equal(await otherRemote.ui.execute("return location.pathname"), "/saved");
    assert.equal(await httpRemote.ui.execute("return location.pathname"), "/");
    await otherRemote.refresh();
    await until("a real HTTP browser reconnects", () => otherRemote.ui.execute("return document.querySelector('[data-app-status] [role=status]')?.textContent === 'Connected'"));
    await otherRemote.ui.section("Now");
    await otherRemote.ui.button("Settings", "[data-player-tools]");
    await until("reconnected browser receives observed Album", () => otherRemote.ui.execute("return [...document.querySelectorAll('[data-player-sheet] button')].some(button => button.textContent.trim() === 'Album' && button.getAttribute('aria-pressed') === 'true')"));
    await close(otherRemote.ui);
    await savedSettings(otherRemote.ui);
    await assertResponsive(otherRemote.ui, "ReplayGain Settings at 390px");
    const layout = await otherRemote.ui.execute("const r = document.querySelector('#preferred-replaygain').getBoundingClientRect(); return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, select: { width: r.width, height: r.height } }");
    assert.ok(layout.select.height >= 44 && layout.select.width >= 44, "ReplayGain keeps its 44px native-style touch target");
    await otherRemote.screenshot("replaygain-http-390");
    await Bun.write(`${artifactDir}/replaygain-layouts.json`, JSON.stringify({ layouts: [layout], sevenWidthIabQualified: false }, null, 2));
    await close(otherRemote.ui);
    await otherRemote.restore();
    await capture(tagged, taggedId, "track", "current-album-to-track", false, true);
    await stop();
    for (const mode of ["off", "track", "album"] as const) await capture(tagged, taggedId, mode, `tagged-${mode}`);
    for (const name of ["boost", "clipping", "untagged", "missing-peak", "missing-peak-attenuation", "r128-missing-peak", "r128-overflow", "r128-nonfinite", "cover-art", "video"]) {
      const fixture = fixtures.find(fixture => fixture.name === name)!;
      await capture(fixture, entries.get(name)!, "album", `${name}-album`);
    }
    await capture(tagged, await enqueue(tagged, true), "album", "radio-album", true);
    await capture(tagged, taggedId, "track", "music-after-radio-video");
    await clients[0]!.command({ type: "preferences", profileId: profile.id, preferences: { replayGain: "album" } });
  } finally {
    if (first().player.playbackId === null && entries.has("tagged")) await play(entries.get("tagged")!);
    if (first().player.playbackId) await clients[0]!.command({ type: "audioDelay", playbackId: first().player.playbackId!, delay: original.preferences.device.audioDelay });
    await stop();
    await clients[0]!.command({ type: "volume", volume: original.volume });
    for (const id of ids.splice(0)) await clients[0]!.command({ type: "remove", entryId: id });
    await api(`/api/profiles/${original.profile.id}/select`, {}, 1);
    await until("ReplayGain qualification restores the original profile, volume and device delay", () => all(state => state.activeProfile.id === original.profile.id && state.player.volume === original.volume && JSON.stringify(state.preferences) === JSON.stringify(original.preferences)));
  }
  await Bun.write(`${artifactDir}/replaygain-controls.json`, JSON.stringify({ profile, realHttpBrowsers: 2, nativeViewport: [1600, 1000], currentAndSavedScopesVerified: true, browserReconnectVerified: true, restartVerified: false }, null, 2));
  return {
    verifyAfterRestart: async () => {
      assert.ok(all(state => state.player.status === "idle" && state.currentEntryId === null), "Actual desktop restart waits for Play");
      await api(`/api/profiles/${profile.id}/select`, {}, 1);
      await until("ReplayGain profile default survives native/sidecar restart", () => all(state => state.preferences?.profile.replayGain === "album"));
      const tagged = fixtures.find(fixture => fixture.name === "tagged")!;
      const id = await enqueue(tagged);
      await clients[0]!.command({ type: "volume", volume: 100 });
      await play(id);
      await until("the first native Play after restart applies saved Album without a current command", () => all(state => state.player.replayGain === "album"));
      await clients[0]!.command({ type: "audioDelay", playbackId: first().player.playbackId!, delay: 0 });
      await capture(tagged, id, "album", "album-after-restart");
      await play(id);
      await clients[0]!.command({ type: "audioDelay", playbackId: first().player.playbackId!, delay: original.preferences.device.audioDelay });
      await stop();
      await clients[0]!.command({ type: "volume", volume: original.volume });
      await clients[0]!.command({ type: "remove", entryId: id });
      await api(`/api/profiles/${original.profile.id}/select`, {}, 1);
      await Bun.write(`${artifactDir}/replaygain-controls.json`, JSON.stringify({ profile, realHttpBrowsers: 2, nativeViewport: [1600, 1000], currentAndSavedScopesVerified: true, browserReconnectVerified: true, restartVerified: true, physicalOutputQualified: false }, null, 2));
    },
  };
}
