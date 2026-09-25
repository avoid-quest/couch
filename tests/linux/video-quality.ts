import { strict as assert } from "node:assert";
import type { SessionState, VideoQuality } from "../../src/shared/protocol";
import { assertResponsive, keys, type startHttpRemote, type UiDriver, type Wait } from "./ui";

type HttpRemote = Awaited<ReturnType<typeof startHttpRemote>>;
type Context = {
  ui: UiDriver;
  httpRemote: HttpRemote;
  otherRemote: HttpRemote;
  until: Wait;
  clients: { state: SessionState | null }[];
  artifactDir: string;
  screenshot: (name: string) => Promise<void>;
};

export async function verifyVideoQuality({ ui, httpRemote, otherRemote, until, clients, artifactDir, screenshot }: Context) {
  const phone = httpRemote.ui, other = otherRemote.ui;
  const initialQueue = structuredClone(clients[0]!.state!.queue);
  const entries = () => clients[0]!.state!.queue.filter(entry => !initialQueue.some(old => old.id === entry.id));
  const close = async (target: UiDriver) => {
    if (await target.execute("return !!document.querySelector('[role=dialog]')")) await target.key(keys.escape);
    else await target.section("Now");
    await until("quality dialog closes", () => target.execute("return !document.querySelector('[role=dialog]')"));
  };
  const settings = async (target: UiDriver) => {
    await target.browse();
    await target.button("Settings");
    await target.settingsSection("remote");
    await until("local quality settings opens", () => target.execute("return !!document.querySelector('[aria-label=\"Video quality\"]')"));
  };
  const selected = async (target: UiDriver, quality: VideoQuality) => {
    await until(`Video quality displays ${quality}`, () => target.execute("return document.querySelector('[aria-label=\"Video quality\"] [data-state=on]')?.textContent.trim() === arguments[0]", [quality === "auto" ? "Recommended" : quality === "best" ? "Best" : quality]));
  };
  const savedProvider = async (target: UiDriver) => {
    await target.section("Saved");
    await until("Saved offers its real enqueue control", () => target.execute("return !!document.querySelector('[aria-label=\"Add Saved provider fixture to Up next\"]')"));
  };
  const enqueueProvider = async (target: UiDriver, quality: VideoQuality) => {
    const before = entries().length;
    await target.button("Add Saved provider fixture to Up next");
    await until(`Online enqueue stores ${quality} for both remotes`, () => clients.every(client => client.state!.queue.filter(entry => !initialQueue.some(old => old.id === entry.id)).length === before + 1 && client.state!.queue.at(-1)!.quality === quality));
  };
  const addLink = async (target: UiDriver, title: string, quality?: VideoQuality, source = "http://127.0.0.1:4200/quality.html") => {
    const before = entries().length;
    await target.section("Find");
    await target.type("#media-search", source);
    await until(`${title} appears as a pasted link`, () => target.execute("return !!document.querySelector('.find-link-card')"));
    if (source.endsWith(".mp3")) await target.button("Direct media", ".find-link-choice");
    if (quality) await target.button(quality === "auto" ? "1080p" : quality, ".find-link-choice");
    else assert.equal(await target.execute("return [...document.querySelectorAll('.find-link-choice > span')].some(span => span.textContent === 'Quality')"), false, "Audio-only links have no video quality choice");
    await target.button("Queue", ".find-link-actions");
    await until(`${title} reaches the shared queue with its intended quality`, () => clients.every(client => client.state!.queue.filter(entry => !initialQueue.some(old => old.id === entry.id)).length === before + 1 && (!quality || client.state!.queue.at(-1)?.quality === quality)));
  };

  await httpRemote.restore();
  await settings(phone);
  await selected(phone, "auto");
  await phone.button("480p", '[aria-label="Video quality"]');
  await assertResponsive(phone, "Phone local quality settings");
  await httpRemote.screenshot("quality-phone-settings");
  await close(phone);
  await httpRemote.refresh();
  await until("the first HTTP browser reconnects after reload", () => phone.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
  await settings(phone);
  await selected(phone, "480p");
  await close(phone);

  await settings(other);
  await selected(other, "auto");
  await other.button("1080p", '[aria-label="Video quality"]');
  await otherRemote.screenshot("quality-second-remote-settings");
  await close(other);
  await otherRemote.minimize();
  await httpRemote.minimize();
  await settings(ui);
  await selected(ui, "auto");
  await screenshot("quality-tv-settings");
  await close(ui);
  assert.deepEqual(clients[0]!.state!.queue, initialQueue, "Saving browser defaults leaves the entire existing queue unchanged");

  await httpRemote.restore();
  await savedProvider(phone);
  await enqueueProvider(phone, "480p");
  await httpRemote.screenshot("quality-phone-online");
  await addLink(phone, "Saved default link", "480p");
  await addLink(phone, "Override link", "720p");
  await addLink(phone, "Default after override", "480p");
  const queuedBeforeChange = structuredClone(clients[0]!.state!.queue);
  await savedProvider(phone);
  await phone.execute(`
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function(value) {
      if (JSON.parse(value).action?.type === 'enqueueProvider') {
        WebSocket.prototype.send = send;
        window.__qualityRelease = () => { send.call(this, value); delete window.__qualityRelease; };
      } else send.call(this, value);
    };
  `);
  await phone.button("Add Saved provider fixture to Up next");
  await settings(phone);
  await selected(phone, "480p");
  await phone.button("720p", '[aria-label="Video quality"]');
  await close(phone);
  assert.deepEqual(clients[0]!.state!.queue, queuedBeforeChange, "Changing the default preserves earlier default and override entries");
  await phone.execute("window.__qualityRelease()");
  await until("pending enqueue keeps the quality selected when it was sent", () => clients.every(client => client.state!.queue.length === queuedBeforeChange.length + 1 && client.state!.queue.at(-1)!.quality === "480p"));
  await until("pending Online enqueue finishes", () => phone.execute("return !document.querySelector('[aria-label=\"Add Saved provider fixture to Up next\"]')?.disabled"));
  await savedProvider(phone);
  await addLink(phone, "Changed default link", "720p");

  await otherRemote.restore();
  await savedProvider(other);
  await enqueueProvider(other, "1080p");
  await addLink(other, "Other remote default link", "1080p");
  await otherRemote.refresh();
  await until("second HTTP browser reconnects with its own stored choice", () => other.execute("return document.querySelector('.header-status [role=status]')?.textContent === 'Connected'"));
  await settings(other);
  await selected(other, "1080p");
  await close(other);
  await otherRemote.minimize();

  await phone.section("Online");
  await addLink(phone, "Audio-only Bandcamp link", undefined, "https://artist.bandcamp.com/track/example");
  await addLink(phone, "Audio-only file link", undefined, "http://127.0.0.1:4200/radio.mp3");
  await phone.type("#media-search", "http://127.0.0.1:4200/radio.mp3");
  await phone.button("Direct media", ".find-link-choice");
  assert.equal(await phone.execute("return [...document.querySelectorAll('.find-link-choice > span')].some(span => span.textContent === 'Quality')"), false, "Direct media keeps its quality-free controls");
  await httpRemote.screenshot("quality-phone-queue");

  await Bun.write(`${artifactDir}/video-quality.json`, JSON.stringify({
    defaults: { firstRemote: "720p", secondRemote: "1080p", tv: "auto" },
    queueBefore: initialQueue, added: entries(),
    observations: "Actual TV Settings and two separate 390px HTTP browser sessions. Settings persistence, Online saved-card enqueue, paste-link enqueue, one-entry overrides, unchanged queued entries and audio-only controls passed. Public Online search is a separate live provider check.",
  }, null, 2));
}
