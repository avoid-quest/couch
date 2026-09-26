import { strict as assert } from "node:assert";
import type { Action, QueueEntry, SessionState } from "../../src/shared/protocol";
import { UiDriver, assertResponsive, keys, startHttpRemote } from "./ui";

const albumUrl = "https://blazo.bandcamp.com/album/jazz-format-mixtape-vol-1";
const missingUrl = "https://blazo.bandcamp.com/track/couch-unavailable-test";
// Public album order captured from the maintained extractor on 2026-09-05.
const albumSources = [
  "intro", "kero-one-keep-it-alive-blazo-remix", "shinsight-trio-heart",
  "dj-mitsu-the-beats-pursuits-of-clarity-ft-agape-from-isosceles", "the-49ers-the-sun",
  "specifics-lifes-work", "choice37-conversate-ft-keroone-el-gambina", "raw-produce-the-wack-mc",
  "the-sound-providers-autumns-evening-breeze", "shin-ski-koyoi-ft-apani-b-fly-mc",
  "blazo-essential-violet", "the-procussions-life-of-brian", "jazz-liberatorz-force-be-with-you-intrumental",
  "the-sound-providers-braggin-boasting-ft-little-brother", "himuki-hold-on-ft-sene",
  "patd-lady-paradox-step-off-ft-laurenjade", "surreal-the-sound-providers-the-rundown",
  "nas-the-world-is-yours-blazo-remix", "the-paranorml-new-melodys", "supersci-on-production",
  "funky-dl-if-i-had-a-day-to-live", "nujabes-the-final-view",
].map(slug => `web:https://blazo.bandcamp.com/track/${slug}`);

type HttpRemote = Awaited<ReturnType<typeof startHttpRemote>>;
type Context = {
  ui: UiDriver;
  origin: string;
  artifacts: string;
  code: string;
  remotes: { token: string; state: SessionState | null }[];
  command: (index: number, action: Action) => void;
  reconnect: (index: number) => void;
  until: (check: () => unknown | Promise<unknown>, timeout?: number) => Promise<void>;
  screenshot: (name: string) => Promise<void>;
  record: (result: Record<string, unknown>) => Promise<void>;
};

export async function captureBandcampAudio(ui: UiDriver, title: string, name: string, artifacts: string, screenshot: Context["screenshot"]) {
  await ui.waitFor("Bandcamp audio shows its title and decoded artwork on the TV", () => ui.execute(`
    const artwork = document.querySelector('[data-player-art] img');
    return document.querySelector('[data-player-audio-copy] h2')?.textContent === arguments[0] && artwork?.naturalWidth > 0 && artwork.getBoundingClientRect().width >= 200;
  `, [title]));
  const rect = await ui.execute(`
    const image = document.querySelector('[data-player-art] img');
    const box = image.getBoundingClientRect();
    const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    const x = box.x + (box.width - width) / 2, y = box.y + (box.height - height) / 2;
    return { x, y, width, height, right: x + width, bottom: y + height };
  `);
  assert.deepEqual(await ui.execute("return [innerWidth, innerHeight, devicePixelRatio]"), [1600, 1000, 1], "Audio artwork CSS coordinates match the native display");
  await screenshot(name);
  const decode = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", `${artifacts}/${name}.png`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { stdout: "pipe", stderr: "inherit" });
  const pixels = new Uint8Array(await new Response(decode.stdout).arrayBuffer());
  assert.equal(await decode.exited, 0);
  assert.equal(pixels.length, 1600 * 1000 * 3);
  let visible = 0, sampled = 0;
  for (let y = Math.ceil(rect.y + 4); y < Math.floor(rect.bottom - 4); y++) for (let x = Math.ceil(rect.x + 4); x < Math.floor(rect.right - 4); x++) {
    const offset = (y * 1600 + x) * 3;
    if (Math.max(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!) > 40) visible++;
    sampled++;
  }
  // Both public covers have broad light areas. This catches the observed black
  // native frame while leaving the generated-video pixel checks unchanged.
  assert.ok(visible > sampled * 0.5, `Native Bandcamp artwork paints above the player: ${visible}/${sampled} nonblack pixels`);
  await Bun.write(`${artifacts}/${name}-artwork.json`, JSON.stringify({ title, rect, visible, sampled, ratio: visible / sampled }, null, 2));
}

export async function verifyBandcamp(context: Context) {
  const { ui, origin, artifacts, code, remotes, command, reconnect, until, screenshot, record } = context;
  let phone: HttpRemote | undefined;
  let phase = "";
  const queue = () => remotes[0]!.state!.queue;
  const idle = () => until(() => remotes.every(remote => remote.state?.player.status === "idle"));
  const save = await fetch(`${origin}/api/providers/favorites`, { method: "POST", headers: { origin, Authorization: `Bearer ${remotes[0]!.token}`, "content-type": "application/json" }, body: JSON.stringify({ item: { provider: "bandcamp", kind: "collection", title: "Jazz Format Mixtape vol.1", url: albumUrl } }) });
  assert.equal(save.status, 200, "A public album can be saved for browsing from the current UI");
  async function albumAction(target: UiDriver, label: "Play" | "Up next") {
    const button = await target.execute("return [...document.querySelectorAll('[role=dialog] button')].find(button => button.textContent.trim() === arguments[0] && !button.hasAttribute('aria-label'))", [label]);
    assert.ok(button, `Album offers ${label}`);
    await target.clickElement(button["element-6066-11e4-a52e-4f735466cecf"]);
  }
  async function observe(entry: QueueEntry) {
    await until(() => {
      const failed = remotes.find(remote => remote.state?.currentEntryId === entry.id && remote.state.player.status === "error");
      if (failed) throw new Error(failed.state!.player.error || "Native Bandcamp playback failed");
      return remotes.every(remote => remote.state?.currentEntryId === entry.id && remote.state.player.status === "playing" && remote.state.player.tracks?.some(track => track.kind === "audio" && track.selected));
    }, 90_000);
    const initial = remotes[0]!.state!.player.position;
    await until(() => remotes.every(remote => remote.state?.currentEntryId === entry.id && remote.state.player.status === "playing" && remote.state.player.position > initial + 2));
    return { entryId: entry.id, source: entry.source, playbackId: remotes[0]!.state!.player.playbackId, initialPosition: initial, position: remotes[0]!.state!.player.position, tracks: remotes[0]!.state!.player.tracks };
  }
  async function openAlbum(target: UiDriver) {
    if (await target.execute("return !!document.querySelector('[role=dialog]')")) await target.key(keys.escape);
    await target.section("Saved");
    await target.click('[aria-label="Saved sections"] [role="tab"]:nth-child(2)');
    await until(async () => await target.execute("return !!document.querySelector('[aria-label=\"Open Jazz Format Mixtape vol.1\"]')"));
    await target.click('[aria-label="Open Jazz Format Mixtape vol.1"]');
    await until(async () => {
      const error = await target.execute("return document.querySelector('.provider-error')?.textContent");
      if (error) throw new Error(error);
      return await target.execute("return document.querySelectorAll('[role=dialog] [aria-label=\"Album tracks\"] li').length") === 22;
    }, 45_000);
    assert.equal(await target.execute("return !!document.querySelector('[role=dialog] [aria-label^=\"Video quality\"]')"), false, "Bandcamp does not offer video quality");
    const titles = await target.execute("return [...document.querySelectorAll('[role=dialog] [aria-label=\"Album tracks\"] h4')].map(title => title.textContent.trim())") as string[];
    assert.equal(titles[0], "Intro");
    assert.equal(titles.at(-1), "Nujabes - The Final View");
    await until(async () => await target.execute("return [...document.querySelectorAll('[role=dialog] img')].some(image => image.naturalWidth > 0)"));
    return titles;
  }
  async function appended(before: Set<string>, titles: string[]) {
    await until(() => remotes.every(remote => remote.state?.queue.filter(entry => !before.has(entry.id)).length === 22), 60_000);
    const entries = queue().filter(entry => !before.has(entry.id));
    assert.deepEqual(entries.map(entry => entry.source), albumSources, "All 22 original public track pages are queued in the observed album order");
    assert.deepEqual(entries.map(entry => entry.title), titles, "Every queued title follows the displayed album order");
    assert.ok(entries.every(entry => entry.thumbnail && !entry.quality), "Audio album rows retain artwork without a video quality cap");
    assert.deepEqual(remotes[1]!.state!.queue, queue(), "The second paired controller observes the complete committed queue");
    for (const entry of entries) {
      assert.equal(new URL(entry.source.slice(4)).hostname, "blazo.bandcamp.com");
      assert.equal("headers" in entry || "audioSource" in entry || "resolvedSource" in entry, false, "Resolved playback credentials stay on the host");
    }
    return entries;
  }
  async function run(name: string, url: string, check: () => Promise<Record<string, unknown>>) {
    const started = performance.now();
    phase = "open a saved Bandcamp album";
    console.log(`START ${name}`);
    let result: Record<string, unknown>;
    try {
      result = { name, url, kind: "webpage", video: false, catalog: { provider: "bandcamp" }, status: "passed", ...await check() };
      console.log(`PASS ${name}`);
    } catch (error) {
      await phone?.minimize().catch(() => {});
      await screenshot(`${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-failed`).catch(() => {});
      const diagnostics = await ui.execute("return { alerts: [...document.querySelectorAll('[role=alert]')].map(element => element.textContent), titles: [...document.querySelectorAll('[aria-label=\"Album tracks\"] h4')].map(element => element.textContent) }").catch(() => null);
      result = { name, url, kind: "webpage", video: false, catalog: { provider: "bandcamp" }, status: "failed", phase, error: String(error), diagnostics };
      console.log(`FAIL ${name} during ${phase}: ${String(error)}`);
    } finally {
      command(0, { type: "stop" });
      await idle();
    }
    await record({ ...result, seconds: (performance.now() - started) / 1000 });
  }

  await run("Bandcamp native album playback and transport", albumUrl, async () => {
    const titles = await openAlbum(ui);
    phase = "return to the saved album and restore keyboard focus";
    await ui.key(keys.escape);
    await until(async () => await ui.execute("return document.activeElement?.getAttribute('aria-label') === 'Open Jazz Format Mixtape vol.1'"));
    await ui.button("Open Jazz Format Mixtape vol.1");
    await until(async () => await ui.execute("return document.querySelectorAll('[role=dialog] [aria-label=\"Album tracks\"] li').length") === 22);
    await screenshot("bandcamp-native-album");
    const before = new Set(queue().map(entry => entry.id));
    phase = "play the complete album through the TV UI";
    await albumAction(ui, "Play");
    const entries = await appended(before, titles);
    const first = await observe(entries[0]!);
    await ui.key(keys.escape);
    phase = "advance to the next ordered track through native controls";
    await ui.controls();
    await ui.button("Next");
    const next = await observe(entries[1]!);
    assert.notEqual(first.playbackId, next.playbackId, "Next starts a new native playback load");
    phase = "replace album playback from a second controller";
    const replacement = queue().find(entry => entry.source === "web:https://relapsealumni.bandcamp.com/track/hail-to-fire") ?? entries[2]!;
    command(1, { type: "play", entryId: replacement.id });
    const replaced = await observe(replacement);
    assert.notEqual(next.playbackId, replaced.playbackId, "A new source replaces the active album track");
    phase = "reconnect a controller during native Bandcamp playback";
    reconnect(1);
    await until(() => remotes[1]!.state?.currentEntryId === replacement.id && remotes[1]!.state.player.playbackId === replaced.playbackId && remotes[1]!.state.player.status === "playing");
    assert.deepEqual(remotes[1]!.state!.queue, queue(), "Reconnect receives the complete current album queue");
    await ui.watching();
    await captureBandcampAudio(ui, replacement.title, "bandcamp-native-audio", artifacts, screenshot);
    phase = "stop Bandcamp through the actual TV control";
    await ui.controls();
    await ui.button("Stop");
    await idle();
    return { entries, observations: [first, next, replaced], qualification: "Native audio tracks and advancing position observed through two paired controllers. No gapless or physical audio claim." };
  });

  await run("Bandcamp HTTP phone album queue and playback", albumUrl, async () => {
    phase = "pair the actual compiled HTTP app in a phone browser";
    phone = await startHttpRemote(origin, code, artifacts, async (_description, check, timeout) => until(check, timeout));
    await phone.restore();
    assert.equal(await phone.ui.execute("return !!document.querySelector('.video-stage, video')"), false, "The HTTP client has no screen view");
    const titles = await openAlbum(phone.ui);
    await phone.ui.execute("document.querySelector('[role=dialog] [aria-label=\"Album tracks\"]').scrollIntoView({ block: 'center' })");
    await assertResponsive(phone.ui, "Phone Bandcamp album");
    await phone.screenshot("bandcamp-http-album");
    await phone.ui.execute("document.querySelector('[role=dialog] [aria-label=\"Album tracks\"] li:nth-child(6)').scrollIntoView({ block: 'center' })");
    await phone.screenshot("bandcamp-http-album-tracks");
    phase = "append the complete album through the phone UI without autoplay";
    let before = new Set(queue().map(entry => entry.id));
    await albumAction(phone.ui, "Up next");
    const queued = await appended(before, titles);
    assert.ok(remotes.every(remote => remote.state?.player.status === "idle"), "Adding a phone album keeps playback stopped");
    phase = "play the complete album through the phone UI";
    before = new Set(queue().map(entry => entry.id));
    await until(async () => await phone!.ui.execute("return [...document.querySelectorAll('[role=dialog] button')].some(button => button.textContent.trim() === 'Play' && !button.disabled)"));
    await albumAction(phone.ui, "Play");
    const played = await appended(before, titles);
    const observation = await observe(played[0]!);
    await phone.ui.key(keys.escape);
    phase = "show native playback and stop from the phone";
    await phone.ui.controls();
    await until(async () => await phone!.ui.execute("return document.querySelector('[data-player-heading] h1')?.textContent === 'Intro' && !!document.querySelector('[data-player-band=shown]')"));
    await phone.ui.execute("window.scrollTo(0, 0)");
    await assertResponsive(phone.ui, "Phone Bandcamp playback controls");
    await phone.screenshot("bandcamp-http-controls");
    await phone.ui.button("Stop");
    await idle();
    await phone.ui.section("Queue");
    await phone.minimize();
    return { queuedEntryIds: queued.map(entry => entry.id), playedEntryIds: played.map(entry => entry.id), observation, observations: "The real 390px HTTP app browsed the ordered album, decoded artwork, added all tracks without autoplay, played Intro on the native host, and stopped it." };
  });

  await run("Bandcamp missing public track failure", missingUrl, async () => {
    await phone?.minimize();
    const before = queue();
    await openAlbum(ui);
    phase = "open the deliberately missing public track in the saved collection browser";
    await ui.type("#provider-search", missingUrl);
    await ui.button("Open", ".provider-search");
    let error = "";
    await until(async () => { error = await ui.execute("return document.querySelector('.provider-error')?.textContent || ''"); return !!error; }, 45_000);
    assert.deepEqual(queue(), before, "A failed catalog lookup does not mutate the queue");
    assert.ok(remotes.every(remote => remote.state?.player.status === "idle"), "A missing track does not start playback");
    await screenshot("bandcamp-missing-track");
    return { expectedFailure: true, error, observations: "The application displayed this concrete upstream failure for a deliberately missing public page; existing queue and stopped playback were preserved." };
  });
  return phone;
}

export async function verifyBandcampRestart(phone: HttpRemote, queue: QueueEntry[], until: Context["until"]) {
  await phone.restore();
  await until(async () => await phone.ui.execute("return document.querySelector('[data-app-status] [role=status]')?.textContent === 'Connected' && document.querySelector('[data-app-status] button[aria-label^=Playing]')?.getAttribute('aria-label')?.endsWith(': Connected')"));
  await phone.ui.section("Queue");
  await until(async () => await phone.ui.execute("return document.querySelectorAll('[data-queue-panel] [data-queue-entry-id]').length") === queue.length);
  assert.deepEqual(await phone.ui.execute("return [...document.querySelectorAll('[data-queue-panel] [data-queue-entry-id] button[aria-label^=\"Play \"]')].map(button => button.getAttribute('aria-label').slice(5))"), queue.map(entry => entry.title), "The reconnected HTTP app receives the persisted album queue in order without autoplay");
  assert.equal(await phone.ui.execute("return !!document.querySelector('.video-stage, video')"), false);
  await phone.screenshot("bandcamp-http-after-restart");
  await phone.minimize();
}
