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
  assert.ok(/libmpv2\s+[^\n]*0\.37\./.test(versions), "Capture expectations explicitly target Ubuntu mpv 0.37");
  await Bun.write(`${artifactDir}/replaygain-versions.txt`, versions);
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
  const play = async (id: string) => {
    const previous = first().player.playbackId;
    await clients[0]!.command({ type: "play", entryId: id, fromStart: true });
    await until("ReplayGain fixture starts in the actual native player", () => all(state => state.currentEntryId === id && state.player.playbackId !== previous && state.player.status === "playing" && state.player.position > 0), 15_000);
  };
  const close = async (driver: UiDriver) => {
    await driver.key(keys.escape);
    await until("ReplayGain dialog closes", () => driver.execute("return !document.querySelector('[role=dialog]')"));
  };
  const savedSettings = async (driver: UiDriver) => {
    await driver.button("Settings");
    await driver.button("Playback", "[role=dialog]");
    await until("saved ReplayGain selector is visible", () => driver.execute("return !!document.querySelector('#preferred-replaygain')"));
  };
  const capture = async (fixture: Fixture, id: string, mode: ReplayGainMode, label: string, radio = false) => {
    await stop();
    await clients[0]!.command({ type: "preferences", profileId: first().activeProfile.id, preferences: { replayGain: mode, speed: 1 } });
    const path = `${artifactDir}/replaygain-${label}.wav`, log = `${artifactDir}/replaygain-${label}.log`;
    const recorder = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "info", "-y", "-f", "pulse", "-sample_rate", String(manifest.sampleRate), "-channels", "2", "-i", "couch.monitor", "-t", "5", "-ac", "1", "-c:a", "pcm_f32le", path], { stdout: "ignore", stderr: Bun.file(log), timeout: 25_000, killSignal: "SIGKILL" });
    try {
      await until("float audio capture is running before Play", async () => await Bun.file(log).exists() && (await Bun.file(log).text()).includes("Output #0"));
      await play(id);
      const excluded = radio || fixture.name === "video" || fixture.name === "r128-overflow";
      await until("native ReplayGain mode matches music eligibility on both controllers", () => all(state => excluded ? state.player.replayGain === undefined : state.player.replayGain === mode));
      const player = structuredClone(first().player);
      assert.equal(await recorder.exited, 0, "Actual Couch audio recording completes");
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
      captures.push({ label, fixture: fixture.file, fixtureSha256: fixture.sha256, mode, radio, player, captureSha256: createHash("sha256").update(Buffer.from(await Bun.file(path).arrayBuffer())).digest("hex"), ...measured });
      await Bun.write(`${artifactDir}/replaygain-captures.json`, JSON.stringify({ versions, captures, physicalOutputQualified: false }, null, 2));
    } finally {
      if (recorder.exitCode === null) { recorder.kill("SIGKILL"); await recorder.exited; }
      await stop();
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
    await ui.button("Playback settings");
    await ui.select("#playback-replaygain", "Track");
    await until("TV current ReplayGain changes only the paused item", () => all(state => state.player.replayGain === "track" && state.preferences?.profile.replayGain === "off" && state.player.playbackId === playbackId));
    assert.deepEqual(await ui.execute("return [innerWidth, innerHeight, devicePixelRatio]"), [1600, 1000, 1]);
    await context.screenshot("replaygain-native-1600x1000");
    await close(ui);
    await httpRemote.restore();
    await httpRemote.ui.section("Library");
    await httpRemote.ui.button("Playback settings");
    await httpRemote.ui.select("#playback-replaygain", "Album");
    await until("first real HTTP browser changes native gain without changing the saved profile", () => all(state => state.player.replayGain === "album" && state.preferences?.profile.replayGain === "off"));
    await httpRemote.ui.button("Save ReplayGain as default");
    await until("explicit Save as default commits observed Album", () => all(state => state.preferences?.profile.replayGain === "album" && state.player.replayGain === "album"));
    await httpRemote.screenshot("replaygain-first-http-current");
    await close(httpRemote.ui);
    await httpRemote.minimize(); await otherRemote.restore();
    await otherRemote.ui.section("Radio");
    await savedSettings(otherRemote.ui);
    await otherRemote.ui.select("#preferred-replaygain", "Off");
    await otherRemote.ui.button("Save preferences", "[role=dialog]");
    await until("second real HTTP browser saves the next-item default without changing current Album", () => all(state => state.preferences?.profile.replayGain === "off" && state.player.replayGain === "album" && state.player.playbackId === playbackId));
    await otherRemote.screenshot("replaygain-second-http-default");
    await close(otherRemote.ui);
    assert.ok((await otherRemote.ui.execute("return document.querySelector('.source-nav [role=tab][data-state=active]')?.textContent")).startsWith("Radio"));
    assert.ok((await httpRemote.ui.execute("return document.querySelector('.source-nav [role=tab][data-state=active]')?.textContent")).startsWith("Library"));
    await otherRemote.refresh();
    await until("a real HTTP browser reconnects", () => otherRemote.ui.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
    await otherRemote.ui.button("Playback settings");
    await until("reconnected browser receives observed Album and saved Off", () => otherRemote.ui.execute("return document.querySelector('#playback-replaygain')?.textContent.trim() === 'Album' && document.querySelector('[role=dialog]').textContent.includes('Default for ReplayGain verification: Off')"));
    await close(otherRemote.ui);
    await savedSettings(otherRemote.ui);
    const layouts = [];
    for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
      const browser = otherRemote.ui;
      const geometry = await browser.execute("return { width: innerWidth, scale: devicePixelRatio }");
      const rect = await browser.request(`/session/${browser.session()}/window/rect`);
      await browser.request(`/session/${browser.session()}/window/rect`, { ...rect, x: 0, y: 0, width: Math.round(rect.width + (width - geometry.width) * geometry.scale), height: 950 });
      await until(`ReplayGain real HTTP viewport reaches ${width}px`, () => browser.execute("return Math.abs(innerWidth - arguments[0]) <= 1", [width]));
      await assertResponsive(browser, `ReplayGain Settings at ${width}px`);
      const layout = await browser.execute("const r = document.querySelector('#preferred-replaygain').getBoundingClientRect(); return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, select: { width: r.width, height: r.height } }");
      assert.ok(layout.select.height >= 44 && layout.select.width >= 44, "ReplayGain keeps its 44px native-style touch target");
      layouts.push(layout);
      await otherRemote.screenshot(`replaygain-http-${width}`);
    }
    await Bun.write(`${artifactDir}/replaygain-layouts.json`, JSON.stringify(layouts, null, 2));
    await close(otherRemote.ui);
    await otherRemote.restore();
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
