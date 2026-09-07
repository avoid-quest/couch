import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import type { Action, SessionState } from "../../src/shared/protocol";
import { assertSubtitlePixels } from "./subtitles";
import { assertNativeVideoPixels } from "./pixels";
import { assertNativePortal, assertResponsive, keys, type UiDriver, type Wait, type startHttpRemote } from "./ui";

type HttpRemote = Awaited<ReturnType<typeof startHttpRemote>>;
type Context = {
  ui: UiDriver; httpRemote: HttpRemote; otherRemote: HttpRemote; until: Wait; artifactDir: string; entryId: string;
  clients: { token: string; state: SessionState | null; command: (action: Action) => Promise<void> }[];
};
const settingsDialog = '[role="dialog"]:has([aria-label="Settings sections"])';
const remoteChoices = '[role="group"][aria-label="This remote interface size"]';
const tvChoices = '[role="group"][aria-label="TV interface size"]';
const scale = (ui: UiDriver) => ui.execute("return Number(getComputedStyle(document.getElementById('root')).zoom)");

async function subtitleMask(artifactDir: string, name: string, sample: { left: number; top: number; width: number; height: number }) {
  const frames = await Promise.all(["off", "on"].map(async state => {
    const decode = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", `${artifactDir}/${name}-${state}.png`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { stdout: "pipe", stderr: "inherit" });
    const pixels = new Uint8Array(await new Response(decode.stdout).arrayBuffer());
    assert.equal(await decode.exited, 0, "The captured subtitle comparison frame decodes");
    assert.equal(pixels.length, 1600 * 1000 * 3);
    return pixels;
  }));
  const [off, on] = frames as [Uint8Array, Uint8Array];
  const mask = new Uint8Array(1600 * 1000);
  for (let y = Math.ceil(sample.height * 0.55); y < sample.height * 0.97; y++) for (let x = Math.ceil(sample.width * 0.05); x < sample.width * 0.95; x++) {
    const pixel = (sample.top + y) * 1600 + sample.left + x;
    const offset = pixel * 3;
    if ([0, 1, 2].some(channel => Math.abs(on[offset + channel]! - off[offset + channel]!) > 35)
      && Math.max(on[offset]!, on[offset + 1]!, on[offset + 2]!) > 180) mask[pixel] = 1;
  }
  await Bun.write(`${artifactDir}/${name}.mask`, mask);
  return mask;
}

async function open(ui: UiDriver, until: Wait) {
  await ui.browse();
  await ui.button("Settings");
  await ui.button("Appearance", '[aria-label="Settings sections"]');
  await until("Appearance loads its controls", () => ui.execute("return !!document.querySelector('#tv-interface-size') && !document.querySelector('[role=dialog]')?.textContent.includes('Loading settings…')"));
}
async function close(ui: UiDriver, until: Wait) {
  await ui.key(keys.escape);
  await until("Settings closes before the next action", () => ui.execute("return !document.querySelector('[role=dialog]')"));
}

export async function verifyAppearance(context: Context) {
  const { ui, httpRemote, otherRemote, until, clients, artifactDir, entryId } = context;
  const phone = httpRemote.ui, other = otherRemote.ui;
  const all = (predicate: (state: SessionState) => boolean) => clients.every(client => !!client.state && predicate(client.state));
  const geometry = () => ui.execute("return document.querySelector('.video-stage').getBoundingClientRect().toJSON()");
  const original = await geometry();
  const queue = clients[0]!.state!.queue.map(entry => entry.id);
  await httpRemote.restore();
  await open(phone, until);
  await phone.button("Largest", remoteChoices);
  await until("browser size applies immediately", async () => await scale(phone) === 1.3);
  await assertResponsive(phone, "Largest phone Appearance settings");
  await httpRemote.screenshot("appearance-phone-largest");
  await close(phone, until);
  await httpRemote.refresh();
  await until("browser size survives reload", async () => await scale(phone) === 1.3);
  await open(phone, until);
  await otherRemote.restore();
  await open(other, until);
  assert.equal(await scale(other), 1, "The second actual browser keeps its default size");
  assert.equal(await other.execute("return !!document.querySelector(arguments[0])", [tvChoices]), false, "An ordinary paired browser cannot edit the shared TV size");
  await other.button("Larger", remoteChoices);
  await until("the second browser changes only its own size", async () => await scale(other) === 1.15 && await scale(phone) === 1.3 && await scale(ui) === 1);
  await close(other, until);
  await otherRemote.minimize();
  await httpRemote.restore();
  await phone.button("Largest", tvChoices);
  await until("TV preview is shared with both WebSocket observers and the native screen", async () => all(state => state.appearance?.size === 1.3 && !!state.appearance.preview) && await scale(ui) === 1.75);
  assert.deepEqual(await geometry(), original, "Interface preview leaves the fullscreen native aperture unchanged");
  await until("native preview is readable", () => ui.execute("return !!document.querySelector('[role=dialog][data-tv-local-only]') && document.querySelector('[role=dialog]')?.textContent.includes('Keep TV size')"));
  await httpRemote.minimize();
  await assertNativePortal(ui, '[role="dialog"][data-tv-local-only]', artifactDir, "appearance-tv-preview");
  await until("unconfirmed TV preview automatically returns to default", async () => all(state => state.appearance?.size === 1 && state.appearance.preview === null) && await scale(ui) === 1, 25_000);
  await httpRemote.restore();
  await phone.button("Largest", tvChoices);
  await phone.button("Keep TV size", settingsDialog);
  await until("confirmed TV size is shared without a remaining preview", async () => all(state => state.appearance?.size === 1.3 && state.appearance.confirmedSize === 1.3 && state.appearance.preview === null) && await scale(ui) === 1.75);
  await close(phone, until);
  await httpRemote.minimize();
  await open(ui, until);
  await ui.execute("[...document.querySelectorAll('[role=dialog] button')].find(button => button.textContent === 'Reset TV to default').focus()");
  await clients[1]!.command({ type: "navigate", key: "select" });
  await ui.request(`/session/${ui.session()}/execute/async`, { script: "const done=arguments[arguments.length-1]; requestAnimationFrame(()=>requestAnimationFrame(()=>done(null)))", args: [] });
  assert.ok(all(state => state.appearance?.confirmedSize === 1.3), "Ordinary remote navigation cannot activate a physical host's privileged reset");
  await ui.button("Reset TV to default", settingsDialog);
  await until("physical pointer reaches TV reset at the largest size", async () => all(state => state.appearance?.confirmedSize === 1) && await scale(ui) === 1);
  await close(ui, until);

  await clients[0]!.command({ type: "play", entryId, fromStart: true });
  await until("native appearance comparison plays the existing multitrack fixture", () => all(state => state.currentEntryId === entryId && state.player.status === "playing" && !!state.player.tracks?.some(track => track.kind === "subtitle")));
  const playbackId = clients[0]!.state!.player.playbackId!;
  await clients[0]!.command({ type: "pause", playbackId, paused: true });
  await until("the native frame is paused for the geometry comparison", () => all(state => state.player.status === "paused"));
  const subtitle = clients[0]!.state!.player.tracks!.find(track => track.kind === "subtitle")!;
  await assertSubtitlePixels(context, subtitle, "appearance-default-subtitles");
  await httpRemote.restore();
  await open(phone, until);
  await phone.button("Largest", tvChoices);
  await phone.button("Keep TV size", settingsDialog);
  await until("largest confirmed TV size applies to the paused native picture", async () => await scale(ui) === 1.75 && all(state => state.appearance?.preview === null));
  await close(phone, until);
  await httpRemote.minimize();
  await ui.watching();
  assert.deepEqual(await geometry(), original, "Native aperture is identical after confirming the largest size");
  await ui.controls();
  const controls = await ui.execute<{ width: number; height: number; icon: number; time: number }>("const button=document.querySelector('.tv-playback-controls .play-button'), rect=button.getBoundingClientRect(); return {width:rect.width,height:rect.height,icon:button.querySelector('svg').getBoundingClientRect().width,time:parseFloat(getComputedStyle(document.querySelector('.time-labels')).fontSize)*Number(getComputedStyle(document.getElementById('root')).zoom)}");
  assert.ok(Math.abs(controls.width - controls.height) < 1, "The native play button is circular at Largest");
  assert.ok(controls.icon >= 40 && controls.time >= 30, "Largest has TV-sized transport icons and time labels");
  await ui.watching();
  await assertNativeVideoPixels(ui.execute, artifactDir, "appearance-largest-video");
  await assertSubtitlePixels(context, subtitle, "appearance-largest-subtitles");
  const defaults = await Bun.file(`${artifactDir}/appearance-default-subtitles-pixels.json`).json();
  const largest = await Bun.file(`${artifactDir}/appearance-largest-subtitles-pixels.json`).json();
  assert.deepEqual(largest.sample, defaults.sample, "The subtitle comparison uses the same native video aperture");
  assert.ok(Math.abs(largest.position - defaults.position) < 0.05, "The subtitle comparison uses the same paused media position");
  const [defaultMask, largestMask] = await Promise.all([
    subtitleMask(artifactDir, "appearance-default-subtitles", defaults.sample),
    subtitleMask(artifactDir, "appearance-largest-subtitles", largest.sample),
  ]);
  const differingCoordinates = defaultMask.reduce((count, value, pixel) => count + Number(value !== largestMask[pixel]), 0);
  assert.equal(differingCoordinates, 0, "Interface scaling leaves every captured subtitle glyph pixel at the same screen coordinate");
  const maskSha256 = createHash("sha256").update(largestMask).digest("hex");
  await ui.home();
  await ui.section("Queue");
  await clients[1]!.command({ type: "navigate", key: "right" });
  await clients[1]!.command({ type: "navigate", key: "select" });
  await until("directional focus selects the next source at the largest TV size", () => ui.execute("return document.querySelector('.source-nav [aria-selected=true]')?.textContent.trim() === 'Online'"));
  await clients[0]!.command({ type: "stop" });
  await until("appearance verification restores idle playback and the original queue", () => all(state => state.player.status === "idle" && JSON.stringify(state.queue.map(entry => entry.id)) === JSON.stringify(queue)));
  await Bun.write(`${artifactDir}/appearance.json`, JSON.stringify({ nativeViewport: [1600, 1000], physical: false, nativeGeometry: original, remoteSizes: [1.3, 1.15], subtitlePixels: largest, subtitleGeometry: { differingCoordinates, maskSha256 }, checks: ["immediate browser size", "browser reload", "two separate HTTP browsers", "administrator scope", "TV timeout", "TV confirmation", "physical pointer reset", "ordinary remote navigation boundary", "directional focus", "native pattern", "identical subtitle screen-coordinate masks"] }, null, 2));
  return {
    async verifyAfterRestart() {
      await until("confirmed TV size survives desktop restart", async () => all(state => state.appearance?.size === 1.3 && state.appearance.preview === null) && await scale(ui) === 1.75);
      assert.deepEqual(await geometry(), original);
      await httpRemote.restore();
      await open(phone, until);
      await phone.button("Reset TV to default", settingsDialog);
      await phone.button("Reset this remote to default", settingsDialog);
      await until("both TV and first browser resets restore default", async () => await scale(phone) === 1 && await scale(ui) === 1);
      await close(phone, until);
      await httpRemote.minimize();
      await otherRemote.restore();
      await open(other, until);
      assert.equal(await scale(other), 1.15, "Second browser size survives the other browser's reset and host restart");
      await other.button("Reset this remote to default", settingsDialog);
      await close(other, until);
      await otherRemote.minimize();
    },
  };
}
