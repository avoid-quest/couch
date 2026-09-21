import { strict as assert } from "node:assert";
import type { Action, SessionState } from "../../src/shared/protocol";
import { assertResponsive, type UiDriver, type Wait, type startHttpRemote } from "./ui";

type Remote = { state: SessionState | null; command: (action: Action) => Promise<void> };

async function nativeWindow() {
  const search = Bun.spawn(["xdotool", "search", "--onlyvisible", "--name", "^Couch$"], { stdout: "pipe", stderr: "inherit" });
  const window = (await new Response(search.stdout).text()).trim().split("\n")[0]!;
  assert.equal(await search.exited, 0, "The actual native TV window exists");
  return window;
}

export async function assertTvFullscreen(ui: UiDriver, until: Wait, description: string) {
  await until(`TV ${description} fills the X11 display with one native video stage`, () => ui.execute(`
    const stage = document.querySelector('.video-stage'), rect = stage?.getBoundingClientRect();
    return document.querySelectorAll('.video-stage').length === 1 && !!document.querySelector('.tv-shell')
      && innerWidth === 1600 && innerHeight === 1000 && rect
      && Math.abs(rect.x) < 1 && Math.abs(rect.y) < 1
      && Math.abs(rect.width - innerWidth) < 1 && Math.abs(rect.height - innerHeight) < 1;
  `));
  const window = await nativeWindow();
  const properties = Bun.spawn(["xprop", "-id", window, "_NET_WM_STATE"], { stdout: "pipe", stderr: "inherit" });
  const state = await new Response(properties.stdout).text();
  assert.equal(await properties.exited, 0);
  assert.match(state, /_NET_WM_STATE_FULLSCREEN/, `TV ${description} is fullscreen in the window manager`);
  assert.equal(await ui.execute("return document.querySelector('[aria-label=\"Toggle fullscreen\"]')"), null, "The TV has no windowed presentation toggle");
}

export async function verifyTvRemote({ ui, until, clients, httpRemote, artifactDir }: {
  ui: UiDriver;
  until: Wait;
  clients: readonly Remote[];
  httpRemote: Awaited<ReturnType<typeof startHttpRemote>>;
  artifactDir: string;
}) {
  const all = (predicate: (state: SessionState) => boolean) => clients.every(client => !!client.state && predicate(client.state));
  const initial = clients[0]!.state!.player;
  assert.ok(clients.length >= 2 && initial.status === "paused", "D-pad acceptance starts with two observers of paused native playback");
  await httpRemote.restore();
  const phone = httpRemote.ui;
  await phone.section("Find");
  await phone.click('[aria-label="Remote"]');
  await until("HTTP phone remote dialog contains the D-pad", () => phone.execute("return !!document.querySelector('[role=dialog] .remote-pad')"));
  await assertResponsive(phone, "Phone remote pad");
  await ui.execute("window.__dpadStage = document.querySelector('.video-stage')");
  await phone.button("TV info");
  await until("phone Info reveals transport controls and focuses Resume", () => ui.execute("return !!document.querySelector('.tv-playback-controls:not([hidden])') && document.activeElement?.getAttribute('aria-label') === 'Resume'"));
  await phone.button("TV select");
  await until("phone OK resumes the same native player for both controllers", () => all(state => state.player.playbackId === initial.playbackId && state.player.status === "playing" && state.player.position > initial.position));
  await phone.button("TV select");
  await until("phone OK pauses the same native player for both controllers", () => all(state => state.player.status === "paused"));
  for (const expected of ["Next in queue", "Stop playback", "Volume"]) {
    await phone.button("TV right");
    await until(`phone Right reaches the TV ${expected} control`, () => ui.execute("return document.activeElement?.getAttribute('aria-label') === arguments[0]", [expected]));
  }
  await phone.button("TV right");
  await until("phone D-pad adjusts the native volume slider", () => all(state => state.player.volume === initial.volume + 1));
  await phone.button("TV left");
  await until("phone D-pad restores the native volume slider", () => all(state => state.player.volume === initial.volume));
  await phone.button("TV home");
  await until("phone Home opens the TV browser and retains the mounted video stage", async () => await ui.execute("return !!document.querySelector('.tv-browser:not([hidden])') && window.__dpadStage === document.querySelector('.video-stage')") && all(state => state.player.playbackId === initial.playbackId && state.player.status === "paused"));
  await assertTvFullscreen(ui, until, "phone D-pad navigation");
  await until("phone remote dialog remains available for the retained screenshot", () => phone.execute("return !!document.querySelector('[role=dialog] .remote-pad')"));
  await httpRemote.screenshot("http-tv-remote");
  await Bun.write(`${artifactDir}/tv-remote.json`, JSON.stringify({ testedAt: new Date().toISOString(), controllers: clients.length, nativeViewport: [1600, 1000], phoneViewport: 390, nativeFullscreen: true, remoteVideoStages: 0, playbackId: initial.playbackId, checks: ["Remote pad", "Info transport focus", "OK transport", "directional focus", "slider adjustment", "mounted native stage"] }, null, 2));
}
