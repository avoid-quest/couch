import { strict as assert } from "node:assert";
import { readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WatchingProfile } from "../../src/shared/library";
import type { Action, MediaTrack, ProfilePlaybackPreferences, SessionState } from "../../src/shared/protocol";
import { assertResponsive, keys, type startHttpRemote, type UiDriver, type Wait } from "./ui";

type Remote = { token: string; state: SessionState | null; command: (action: Action) => Promise<void> };
type Context = { ui: UiDriver; until: Wait; clients: readonly Remote[]; artifactDir: string };
type HttpRemote = Awaited<ReturnType<typeof startHttpRemote>>;
type PreferenceContext = Context & {
  origin: string;
  httpRemote: HttpRemote;
  api: (path: string, body?: unknown, index?: number) => Promise<any>;
  entryId: string;
};
type SavedPreferences = { household: WatchingProfile; otherProfile: WatchingProfile; householdPreferences: ProfilePlaybackPreferences; otherPreferences: ProfilePlaybackPreferences; audioDelay: number };

function controls({ clients, until }: Pick<Context, "clients" | "until">) {
  const first = () => clients[0]!.state!;
  const all = (predicate: (state: SessionState) => boolean) => clients.every(client => client.state && predicate(client.state));
  const track = async (index: number, label: string) => {
    await clients[1]!.command({ type: "track", playbackId: first().player.playbackId!, kind: "subtitle", index });
    await until(label, () => all(state => index < 0 ? !state.player.tracks?.some(track => track.kind === "subtitle" && track.selected) : state.player.tracks?.some(track => track.kind === "subtitle" && track.index === index && track.selected) === true));
  };
  const stop = async () => {
    await clients[0]!.command({ type: "stop" });
    await until("subtitle acceptance stops native playback before changing profile", () => all(state => state.player.status === "idle"));
  };
  return { first, all, track, stop };
}

async function settings(ui: UiDriver, until: Wait) {
  await ui.button("Playback settings");
  await until("playback settings exposes its subtitle upload control", async () => await ui.execute("return !!document.querySelector('[role=dialog] #playback-subtitle-file')"));
}

async function closeSettings(ui: UiDriver, until: Wait) {
  await ui.key(keys.escape);
  await until("Escape closes playback settings and restores its trigger", async () => await ui.execute("return !document.querySelector('[role=dialog]') && document.activeElement?.textContent.trim() === 'Playback settings'"));
}

async function uploadFile(ui: UiDriver, path: string) {
  const input = await ui.element("#playback-subtitle-file");
  // The W3C file-input command uses the browser's real File and change event.
  await ui.request(`/session/${ui.session()}/element/${input}/value`, { text: path });
}

async function uploadedFiles() {
  const directories = (await readdir(tmpdir())).filter(name => name.startsWith("couch-subtitles-"));
  return (await Promise.all(directories.map(async directory => (await readdir(join(tmpdir(), directory))).map(name => join(tmpdir(), directory, name))))).flat();
}

async function nativeFrame(artifactDir: string, name: string) {
  const path = `${artifactDir}/${name}.png`;
  const capture = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab", "-video_size", "1600x1000", "-i", process.env.DISPLAY!, "-frames:v", "1", path], { stdout: "ignore", stderr: "inherit" });
  assert.equal(await capture.exited, 0, "Native subtitle X11 capture succeeds");
  const decode = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { stdout: "pipe", stderr: "inherit" });
  const pixels = new Uint8Array(await new Response(decode.stdout).arrayBuffer());
  assert.equal(await decode.exited, 0, "Native subtitle capture decodes");
  return pixels;
}

async function assertSubtitlePixels(context: Context, subtitle: MediaTrack, name: string) {
  const { ui, artifactDir, until } = context;
  const { first, all, track } = controls(context);
  assert.ok(all(state => state.player.status === "paused"), "Subtitle pixel comparison uses the same paused video frame");
  await ui.watching();
  await ui.execute(`window.scrollTo(0, 0); const marker = document.createElement('div'); marker.id = 'subtitle-origin';
    Object.assign(marker.style, { position: 'fixed', left: '8px', top: '8px', width: '8px', height: '8px', background: 'rgb(13,217,101)', zIndex: '100000', pointerEvents: 'none' });
    document.body.append(marker); document.querySelectorAll('.pairing-display, .pair-shortcut strong').forEach(element => element.style.visibility = 'hidden');`);
  try {
    const position = first().player.position;
    await track(-1, `${name} subtitles are observed off before the pixel comparison`);
    await Bun.sleep(350);
    const stage = await ui.execute("const rect = document.querySelector('.video-stage').getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }") as { x: number; y: number; width: number; height: number };
    const off = await nativeFrame(artifactDir, `${name}-off`);
    await track(subtitle.index, `${name} selected subtitle is observed by both controllers`);
    await Bun.sleep(350);
    const on = await nativeFrame(artifactDir, `${name}-on`);
    let origin = -1;
    for (let offset = 0; offset < off.length; offset += 3) if (off[offset] === 13 && off[offset + 1] === 217 && off[offset + 2] === 101) { origin = offset / 3; break; }
    assert.ok(origin >= 0, "Subtitle comparison locates the displayed WebView marker");
    const scale = Math.min(stage.width / 640, stage.height / 360);
    const width = Math.floor(640 * scale), height = Math.floor(360 * scale);
    const left = Math.round(origin % 1600 - 8 + stage.x + (stage.width - width) / 2);
    const top = Math.round(Math.floor(origin / 1600) - 8 + stage.y + (stage.height - height) / 2);
    assert.ok(left >= 0 && top >= 0 && left + width <= 1600 && top + height <= 1000, "Native subtitle sample lies inside the video aperture");
    let subtitleChanges = 0, upperChanges = 0;
    for (let y = Math.ceil(height * 0.1); y < height * 0.97; y++) for (let x = Math.ceil(width * 0.05); x < width * 0.95; x++) {
      const offset = ((top + y) * 1600 + left + x) * 3;
      const changed = [0, 1, 2].some(channel => Math.abs(on[offset + channel]! - off[offset + channel]!) > 35);
      if (changed && y < height * 0.5) upperChanges++;
      if (changed && y > height * 0.55 && Math.max(on[offset]!, on[offset + 1]!, on[offset + 2]!) > 180) subtitleChanges++;
    }
    assert.ok(upperChanges < width * height * 0.001, `${name}: paused upper video remains unchanged (${upperChanges} pixels)`);
    assert.ok(subtitleChanges >= 80, `${name}: libmpv renders external subtitle glyphs (${subtitleChanges} changed bright pixels)`);
    await until(`${name} renders visible native subtitle pixels without advancing playback`, () => all(state => state.player.status === "paused" && Math.abs(state.player.position - position) < 0.05));
    await Bun.write(`${artifactDir}/${name}-pixels.json`, JSON.stringify({ subtitleChanges, upperChanges, sample: { left, top, width, height }, position }, null, 2));
  } finally { await ui.execute("document.getElementById('subtitle-origin')?.remove()"); }
}

export async function verifyExternalSubtitles(context: Context & { origin: string; httpRemote: HttpRemote }) {
  const { ui, until, clients, httpRemote, origin } = context;
  const { first, all, track } = controls(context);
  const playbackId = first().player.playbackId!;
  const original = first().player.tracks!.find(track => track.kind === "subtitle" && track.selected)?.index ?? -1;
  await settings(ui, until);
  await uploadFile(ui, "/fixtures/external-tv.srt");
  await until("TV file input uploads real SRT bytes and both remotes observe its selected native track", () => all(state => state.player.tracks?.some(track => track.kind === "subtitle" && track.selected && track.label.includes("external-tv.srt")) === true));
  const srt = first().player.tracks!.find(track => track.label.includes("external-tv.srt"))!;
  await uploadFile(ui, "/fixtures/invalid-subtitle.srt");
  await until("invalid subtitle upload has a useful error without interrupting native playback", async () => await ui.execute("return [...document.querySelectorAll('[role=alert]')].some(element => element.textContent.includes('does not contain supported text subtitles'))") && all(state => state.player.playbackId === playbackId && state.player.status === "paused"));
  await closeSettings(ui, until);
  await assertSubtitlePixels(context, srt, "native-external-srt");
  await httpRemote.restore();
  await settings(httpRemote.ui, until);
  await assertResponsive(httpRemote.ui, "Phone subtitle upload");
  await uploadFile(httpRemote.ui, "/fixtures/external-phone.ass");
  await until("HTTP phone file input uploads real ASS bytes to the selected native track", () => all(state => state.player.tracks?.some(track => track.kind === "subtitle" && track.selected && track.label.includes("external-phone.ass")) === true));
  const ass = first().player.tracks!.find(track => track.label.includes("external-phone.ass"))!;
  await httpRemote.ui.select("#playback-subtitles", "Off");
  await until("phone Subtitles Off is observed by both remotes", () => all(state => !state.player.tracks?.some(track => track.kind === "subtitle" && track.selected)));
  await httpRemote.ui.select("#playback-subtitles", srt.label || srt.language || `Subtitle ${srt.index + 1}`);
  await until("phone can reselect the subtitle uploaded from the TV", () => all(state => state.player.tracks?.some(track => track.kind === "subtitle" && track.index === srt.index && track.selected) === true));
  await closeSettings(httpRemote.ui, until);
  await httpRemote.minimize();
  await assertSubtitlePixels(context, ass, "native-external-ass");
  const files = await uploadedFiles();
  assert.equal(files.length, 2, "Invalid input creates no host subtitle file");
  for (const file of files) assert.equal((await stat(file)).mode & 0o777, 0o600, "Uploaded subtitles are readable only by the host user");
  for (const client of clients) {
    const snapshot = JSON.stringify(client.state);
    for (const secret of [...files, "/fixtures/", client.token]) assert.ok(!snapshot.includes(secret), "Controller snapshots omit host subtitle paths and credentials");
  }
  for (const [name, body, status] of [["../../host-file.srt", "1\n00:00:00,000 --> 00:00:10,000\nunsafe path\n", 400], ["too-large.srt", "x".repeat(2 * 1024 * 1024 + 1), 413]] as const) {
    const response = await fetch(`${origin}/api/subtitles?${new URLSearchParams({ playbackId, name })}`, { method: "POST", headers: { origin, Authorization: `Bearer ${clients[1]!.token}`, "Content-Type": "application/octet-stream" }, body });
    assert.equal(response.status, status, "The paired HTTP upload rejects host paths and oversized files");
  }
  await track(original, "subtitle acceptance restores the original embedded selection");
}

export async function assertSubtitleCleanup({ until, clients }: Pick<Context, "until" | "clients">) {
  await until("source replacement removes uploaded subtitle files and public track metadata", async () => (await uploadedFiles()).length === 0 && clients.every(client => !client.state?.player.tracks?.some(track => track.label.includes("external-tv.srt") || track.label.includes("external-phone.ass"))));
}

export async function verifyJellyfinSubtitles(context: Context & { config: { containerUrl: string; accessToken: string; password: string } }) {
  const { until, clients, config } = context;
  const { first, all } = controls(context);
  const playbackId = first().player.playbackId!;
  await until("real Jellyfin sidecar appears as an Italian native subtitle track", () => all(state => state.player.tracks?.some(track => track.kind === "subtitle" && track.language === "ita") === true));
  const original = first().player.tracks!.find(track => track.kind === "subtitle" && track.selected)?.index ?? -1;
  await clients[0]!.command({ type: "pause", playbackId, paused: true });
  await clients[0]!.command({ type: "seek", playbackId, position: 6 });
  await until("real Jellyfin pauses at the subtitle sample", () => all(state => state.player.status === "paused" && Math.abs(state.player.position - 6) < 0.3));
  await assertSubtitlePixels(context, first().player.tracks!.find(track => track.kind === "subtitle" && track.language === "ita")!, "native-jellyfin-external-srt");
  for (const client of clients) for (const secret of [config.containerUrl, config.accessToken, config.password, "/Videos/", "/media/Movies/"]) assert.ok(!JSON.stringify(client.state).includes(secret), "Jellyfin external subtitle URLs, paths and credentials stay on the host");
  await controls(context).track(original, "Jellyfin subtitle acceptance restores its original selection");
  await clients[0]!.command({ type: "pause", playbackId, paused: false });
  await until("Jellyfin keeps playing after external subtitle selection", () => all(state => state.player.status === "playing"));
}

async function savePreferences(ui: UiDriver, until: Wait, preferences: ProfilePlaybackPreferences, phone = false) {
  await settings(ui, until);
  await ui.button("Saved preferences", "[role=dialog]");
  if (phone) await assertResponsive(ui, "Phone saved playback preferences");
  await ui.type("#preferred-audio-language", preferences.audioLanguage);
  await ui.type("#preferred-subtitle-language", preferences.subtitleLanguage);
  await ui.select("#preferred-subtitle-mode", preferences.subtitles === "off" ? "Off" : "Automatic");
  await ui.select("#preferred-playback-speed", preferences.speed === 1 ? "Normal" : `${preferences.speed}×`);
  await ui.button("Save preferences", "[role=dialog]");
  await until("the saved-preferences form confirms a committed change", async () => await ui.execute("return [...document.querySelectorAll('[role=dialog] [role=status]')].some(element => element.textContent.startsWith('Preferences saved for '))"));
  await closeSettings(ui, until);
}

async function assertPreferencesLoad(context: PreferenceContext, preferences: ProfilePlaybackPreferences, audioDelay: number, description: string) {
  const { clients, entryId, until } = context;
  const { first, all } = controls(context);
  const previous = first().player.playbackId;
  await clients[1]!.command({ type: "play", entryId, fromStart: true });
  await until(description, () => all(state => state.player.playbackId !== previous && state.currentEntryId === entryId && state.player.status === "playing" && state.player.speed === preferences.speed && Math.abs((state.player.audioDelay ?? 0) - audioDelay) < 1e-6 && state.player.subtitleDelay === 0 && state.player.tracks?.some(track => track.kind === "audio" && track.selected && track.language === preferences.audioLanguage) === true && (preferences.subtitles === "off" ? !state.player.tracks?.some(track => track.kind === "subtitle" && track.selected) : state.player.tracks?.some(track => track.kind === "subtitle" && track.selected && track.language === preferences.subtitleLanguage) === true)));
  await clients[0]!.command({ type: "pause", playbackId: first().player.playbackId!, paused: true });
  await until("native preference verification pauses before the next UI action", () => all(state => state.player.status === "paused"));
}

export async function verifyPlaybackPreferences(context: PreferenceContext & { otherProfile: WatchingProfile }): Promise<SavedPreferences> {
  const { ui, until, clients, api, httpRemote, otherProfile } = context;
  const { first, all, stop } = controls(context);
  const household = first().activeProfile;
  const householdPreferences: ProfilePlaybackPreferences = { audioLanguage: "ita", subtitleLanguage: "eng", subtitles: "off", speed: 1.25 };
  const otherPreferences: ProfilePlaybackPreferences = { audioLanguage: "eng", subtitleLanguage: "eng", subtitles: "auto", speed: 0.75 };
  const audioDelay = 0.4;
  await stop();
  await httpRemote.minimize();
  await savePreferences(ui, until, householdPreferences);
  await until("TV preferences are committed to Household and broadcast to both controllers", () => all(state => JSON.stringify(state.preferences?.profile) === JSON.stringify(householdPreferences)));
  await assertPreferencesLoad(context, householdPreferences, first().preferences!.device.audioDelay, "saved Household audio, subtitle mode and speed apply to the next native load");
  await httpRemote.restore();
  await settings(httpRemote.ui, until);
  await httpRemote.ui.type("#playback-audio-delay", String(audioDelay));
  const apply = await httpRemote.ui.execute("return document.querySelector('#playback-audio-delay').closest('form').querySelector('button')");
  await httpRemote.ui.clickElement(apply["element-6066-11e4-a52e-4f735466cecf"]);
  await until("phone audio-delay control updates native playback and the persistent TV preference", () => all(state => Math.abs((state.player.audioDelay ?? 0) - audioDelay) < 1e-6 && state.preferences?.device.audioDelay === audioDelay));
  await closeSettings(httpRemote.ui, until);
  await clients[0]!.command({ type: "subtitleDelay", playbackId: first().player.playbackId!, delay: 0.8 });
  await until("subtitle delay applies to the current item", () => all(state => Math.abs((state.player.subtitleDelay ?? 0) - 0.8) < 1e-6));
  await stop();
  await api(`/api/profiles/${otherProfile.id}/select`, {}, 1);
  await until("changing watching profile replaces its playback preferences while retaining the TV audio delay", () => all(state => state.activeProfile.id === otherProfile.id && state.preferences?.device.audioDelay === audioDelay && state.preferences.profile.speed === 1));
  await assert.rejects(clients[0]!.command({ type: "preferences", profileId: household.id, preferences: householdPreferences }), "A stale controller cannot overwrite the previous profile's preferences");
  await savePreferences(httpRemote.ui, until, otherPreferences, true);
  await until("phone preferences are committed only to its active watching profile", () => all(state => JSON.stringify(state.preferences?.profile) === JSON.stringify(otherPreferences)));
  await httpRemote.minimize();
  await assertPreferencesLoad(context, otherPreferences, audioDelay, "second profile selects English audio and subtitles, restores its speed and resets per-item subtitle delay");
  await stop();
  await api(`/api/profiles/${household.id}/select`, {});
  await until("returning to Household restores its isolated language, subtitle and speed preferences", () => all(state => state.activeProfile.id === household.id && JSON.stringify(state.preferences?.profile) === JSON.stringify(householdPreferences)));
  await assertPreferencesLoad(context, householdPreferences, audioDelay, "Household preference selection remains correct after changing profiles");
  await stop();
  return { household, otherProfile, householdPreferences, otherPreferences, audioDelay };
}

export async function assertPlaybackPreferencesAfterRestart(context: PreferenceContext, expected: SavedPreferences) {
  const { until, api, httpRemote } = context;
  const { all, stop } = controls(context);
  await until("saved playback preferences survive the desktop restart without autoplay", () => all(state => state.player.status === "idle" && state.activeProfile.id === expected.household.id && JSON.stringify(state.preferences?.profile) === JSON.stringify(expected.householdPreferences) && state.preferences?.device.audioDelay === expected.audioDelay));
  await httpRemote.restore();
  await settings(httpRemote.ui, until);
  await httpRemote.ui.button("Saved preferences", "[role=dialog]");
  await until("reconnected HTTP phone displays the persisted profile and device preferences", async () => await httpRemote.ui.execute("return document.querySelector('#preferred-audio-language')?.value === 'ita' && document.querySelector('#preferred-subtitle-mode')?.textContent.trim() === 'Off' && document.querySelector('[role=dialog]')?.textContent.includes('TV audio delay is 0.4 seconds')"));
  await closeSettings(httpRemote.ui, until);
  await httpRemote.minimize();
  for (const [profile, preferences] of [[expected.household, expected.householdPreferences], [expected.otherProfile, expected.otherPreferences]] as const) {
    await api(`/api/profiles/${profile.id}/select`, {}, 1);
    await until(`${profile.name} restores its saved playback preferences after restart`, () => all(state => state.activeProfile.id === profile.id && JSON.stringify(state.preferences?.profile) === JSON.stringify(preferences) && state.preferences?.device.audioDelay === expected.audioDelay));
    await assertPreferencesLoad(context, preferences, expected.audioDelay, `${profile.name} preferences are observed by libmpv after a real desktop restart`);
    await stop();
  }
  await api(`/api/profiles/${expected.household.id}/select`, {});
  await until("subtitle acceptance restores Household and leaves native playback stopped", () => all(state => state.player.status === "idle" && state.activeProfile.id === expected.household.id));
}
