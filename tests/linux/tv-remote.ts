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
  await phone.section("Radio");
  await phone.controls();
  await until("HTTP phone Remote mode contains controls and no video stage or screen placeholder", () => phone.execute("return !!document.querySelector('.remote-control') && !document.querySelector('.video-stage, .remote-stage, .stage-caption, video') && document.querySelector('.media-browser').getClientRects().length === 0"));
  await assertResponsive(phone, "Phone remote pad");
  await ui.execute("window.__dpadStage = document.querySelector('.video-stage')");
  await phone.button("TV home");
  await until("phone Home opens the TV browser without changing playback", async () => await ui.execute("return !!document.querySelector('.tv-browser:not([hidden])')") && all(state => state.player.playbackId === initial.playbackId && state.player.status === "paused"));
  await until("phone Home restores focus to the selected TV Queue tab", () => ui.execute("return document.activeElement?.getAttribute('data-source') === 'Queue' && document.activeElement?.getAttribute('aria-selected') === 'true'"));
  await phone.button("TV right");
  await phone.button("TV select");
  await until("phone direction and OK activate the TV Search tab", () => ui.execute("return document.querySelector('.source-nav [aria-selected=true]')?.textContent.trim() === 'Search' && document.activeElement?.getAttribute('data-source') === 'Search'"));
  // The test phone shares the TV's X11 display. WebKit suppresses :focus while
  // that other window is active; real phones do not take the TV's window focus.
  await httpRemote.minimize();
  const focus = Bun.spawn(["xdotool", "windowactivate", "--sync", await nativeWindow()], { stdout: "ignore", stderr: "inherit" });
  assert.equal(await focus.exited, 0, "The TV owns window focus while its focus ring is inspected");
  await until("phone D-pad gives the TV a visible keyboard focus ring", () => ui.execute("const style = getComputedStyle(document.activeElement); return document.documentElement.hasAttribute('data-keyboard') && ((parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none') || style.boxShadow !== 'none')"));
  await httpRemote.restore();
  await phone.button("TV back");
  await until("phone Back leaves TV browsing and retains its Search selection", () => ui.execute("return !!document.querySelector('.tv-browser[hidden]') && document.querySelector('.source-nav [aria-selected=true]')?.textContent.trim() === 'Search'"));
  await phone.button("TV back");
  await until("a second phone Back hides the playback overlay", () => ui.execute("return !!document.querySelector('.tv-playback-controls[hidden]') && !!document.querySelector('.tv-browser[hidden]')"));
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
  await phone.button("TV down");
  await until("phone Down leaves the horizontal volume slider for another TV control", () => ui.execute("return document.activeElement?.getAttribute('aria-label') !== 'Volume' && !!document.activeElement?.closest('.tv-playback-controls')"));

  // Open the real settings dialog, then operate its focused Radix select solely
  // through the phone. This exercises the host event path and portal focus trap.
  await ui.button("Playback settings");
  await ui.click("#playback-speed");
  await phone.button("TV back");
  await until("phone Back closes only the topmost TV select and restores its trigger", () => ui.execute("return !document.querySelector('[role=listbox]') && !!document.querySelector('[role=dialog]') && document.activeElement?.id === 'playback-speed'"));
  await phone.button("TV select");
  await until("phone OK opens the focused TV Radix select", () => ui.execute("return !!document.querySelector('[role=listbox]') && document.activeElement?.getAttribute('role') === 'option'"));
  await phone.button("TV down");
  await phone.button("TV select");
  await until("phone Down and OK select 2× on the TV and both playback observers", async () => await ui.execute("return !document.querySelector('[role=listbox]') && document.querySelector('#playback-speed')?.textContent.trim() === '2×'") && all(state => state.player.speed === 2));
  await phone.button("TV select");
  await until("TV speed select opens again from restored focus", () => ui.execute("return !!document.querySelector('[role=listbox]')"));
  await phone.button("TV up");
  await phone.button("TV select");
  await until("phone restores the previous playback speed", () => all(state => state.player.speed === initial.speed));
  await phone.button("TV back");
  await until("phone Back closes TV settings and restores Playback settings focus", () => ui.execute("return !document.querySelector('[role=dialog]') && document.activeElement?.textContent.trim() === 'Playback settings'"));
  await phone.button("TV home");
  await until("phone Home restores the TV source and continuously mounted video stage", () => ui.execute("return !!document.querySelector('.tv-browser:not([hidden])') && document.querySelector('.source-nav [aria-selected=true]')?.textContent.trim() === 'Online' && window.__dpadStage === document.querySelector('.video-stage')"));
  await assertTvFullscreen(ui, until, "phone D-pad navigation");
  await phone.browse();
  await until("phone Browse retains Radio while D-pad navigation changed the TV to Online", () => phone.execute("return document.querySelector('.source-nav [aria-selected=true]')?.textContent.trim() === 'Radio' && !document.querySelector('.video-stage')"));
  await assertResponsive(phone, "Phone Browse after TV navigation");
  await phone.controls();
  await httpRemote.screenshot("http-tv-remote");
  await Bun.write(`${artifactDir}/tv-remote.json`, JSON.stringify({ testedAt: new Date().toISOString(), controllers: clients.length, nativeViewport: [1600, 1000], phoneViewport: 390, nativeFullscreen: true, remoteVideoStages: 0, playbackId: initial.playbackId, checks: ["Home/Back/Info", "directional focus", "visible focus", "OK transport", "slider adjustment and exit", "Radix selection and focus restoration", "local phone browsing", "mounted native stage"] }, null, 2));
  await ui.section("Queue");
  await phone.section("Queue");
}
