import { mkdir, rename, rm } from "node:fs/promises";
import type { LibraryItem, LibrarySource } from "../../src/shared/library";
import type { MusicContext } from "./music";
import { assertResponsive } from "./ui";
import { strict as assert } from "node:assert";
import { keys, type UiDriver, type Wait } from "./ui";

export const folderSettings = '[aria-label="TV folder settings"]';
export const folderCard = (id: string) => `${folderSettings} [data-folder-source="${id}"]`;
export async function openFolderSources(ui: UiDriver, until: Wait) {
  await ui.button("Settings");
  await ui.settingsSection("source-folders");
  await until("Library opens its canonical Sources folder manager", () => ui.execute("return document.querySelectorAll(arguments[0]).length === 1 && [...document.querySelectorAll(arguments[0] + ' button')].some(button => button.textContent.trim() === 'Add TV folder' && !button.disabled)", [folderSettings]));
}
export async function closeFolderSources(ui: UiDriver, until: Wait) {
  if (await ui.execute("return !!document.querySelector('.settings-page:not([hidden])')")) {
    await ui.section("Files");
    return;
  }
  await ui.key(keys.escape);
  await until("folder Sources closes before browsing", () => ui.execute("return !document.querySelector('[role=dialog]')"));
}
async function chooseTVFolder(ui: UiDriver, until: Wait, name: string) {
  await openFolderSources(ui, until);
  await ui.button("Add TV folder", folderSettings);
  const browser = '[aria-label="TV folder browser"]';
  await until("TV folder browser exposes permitted media locations", () => ui.execute("return !!document.querySelector(arguments[0]) && [...document.querySelectorAll(arguments[0] + ' button')].some(button => button.textContent.trim() === 'mnt' && !button.disabled)", [browser]));
  await ui.button("mnt", browser);
  await until("mounted media location lists the fixture folder", () => ui.execute("return [...document.querySelectorAll(arguments[0] + ' button')].some(button => button.textContent.trim() === arguments[1] && !button.disabled)", [browser, name]));
  await ui.button(name, browser);
  await until("selected TV fixture directory is ready to register", () => ui.execute("return document.querySelector(arguments[0])?.textContent.includes(arguments[1]) && [...document.querySelectorAll(arguments[0] + ' button')].some(button => button.textContent.trim() === 'Test and add this folder' && !button.disabled)", [browser, `/mnt/${name}`]));
}
export async function addTVFolder(ui: UiDriver, until: Wait, name: string) {
  await chooseTVFolder(ui, until, name);
  await ui.button("Test and add this folder", '[aria-label="TV folder browser"]');
  let id = "";
  await until("verified TV source appears with an explicit scan action", async () => {
    id = await ui.execute("return [...document.querySelectorAll('[data-folder-source]')].find(card => card.textContent.includes(arguments[0]) && [...card.querySelectorAll('button')].some(button => button.textContent.trim() === 'Start scan' && !button.disabled))?.getAttribute('data-folder-source') ?? ''", [`/mnt/${name}`]);
    return !!id;
  });
  assert.ok(id);
  await ui.button("Start scan", folderCard(id));
  await closeFolderSources(ui, until);
  return id;
}

export async function verifyFolderSettings({ origin, until, clients, api, httpRemote, artifactDir }: MusicContext) {
  const name = "folder-settings-fixture", path = `/mnt/${name}`, offline = `${path}-offline`;
  await mkdir(path);
  await Bun.write(`${path}/Folder acceptance.mkv`, Bun.file("/mnt/fixtures/multitrack.mkv"));
  await Bun.write(`${path}/Folder acceptance.nfo`, "<movie><title>Folder acceptance</title></movie>");
  const phone = httpRemote.ui;
  const originalQueue = structuredClone(clients[0]!.state!.queue);
  const all = (predicate: (state: NonNullable<typeof clients[number]["state"]>) => boolean) => clients.every(client => !!client.state && predicate(client.state));
  const sources = async (): Promise<LibrarySource[]> => (await api("/api/library/sources")).sources;
  const items = async (): Promise<LibraryItem[]> => (await api("/api/library/items?q=Folder%20acceptance")).items;
  const stop = async () => {
    await clients[0]!.command({ type: "stop" });
    await until("folder acceptance stops the native player on every controller", () => all(state => state.player.status === "idle" && !state.currentEntryId));
  };
  const restoreQueue = async () => {
    await stop();
    for (const entry of [...clients[0]!.state!.queue]) if (!originalQueue.some(original => original.id === entry.id)) await clients[0]!.command({ type: "remove", entryId: entry.id });
    await until("folder acceptance preserves the earlier queue identities and order", () => all(state => JSON.stringify(state.queue.map(entry => entry.id)) === JSON.stringify(originalQueue.map(entry => entry.id))));
  };
  let sourceId = "", item!: LibraryItem;
  const ready = async (status: LibrarySource["status"]) => until(`folder source reaches ${status}`, async () => (await sources()).some(source => source.id === sourceId && source.status === status));
  const action = async (label: string) => {
    await until(`folder ${label} control is ready`, () => phone.execute("return [...document.querySelectorAll(arguments[0] + ' button')].some(button => button.textContent.trim() === arguments[1] && !button.disabled)", [folderCard(sourceId), label]));
    await phone.button(label, folderCard(sourceId));
  };
  const play = async () => {
    await phone.section("Library");
    await phone.type("#media-search", item.title);
    const region = '[aria-label="Search results"]';
    await until("phone library finds the retained folder item", () => phone.execute("return !!document.querySelector(arguments[0])", [`${region} [aria-label=${JSON.stringify(`Play ${item.title}`)}], ${region} [aria-label=${JSON.stringify(`Resume ${item.title}`)}]`]));
    await phone.click(`${region} [aria-label=${JSON.stringify(`Play ${item.title}`)}], ${region} [aria-label=${JSON.stringify(`Resume ${item.title}`)}]`);
    await until("phone folder Play reaches the one native player with the saved media identity", () => all(state => state.player.status === "playing" && state.player.position > 0.5 && state.queue.find(entry => entry.id === state.currentEntryId)?.source === `library:${item.id}`), 30_000);
    assert.equal(await phone.execute("return !!document.querySelector('.video-stage')"), false);
  };
  await stop();
  await httpRemote.restore();
  try {
    sourceId = await addTVFolder(phone, until, name);
    await ready("ready");
    const found = await items(); assert.equal(found.length, 1); item = found[0]!;
    await openFolderSources(phone, until);
    await assertResponsive(phone, "Phone TV folder Sources");
    await httpRemote.screenshot("folder-sources-phone");
    await closeFolderSources(phone, until);
    await chooseTVFolder(phone, until, name);
    await phone.button("Test and add this folder", '[aria-label="TV folder browser"]');
    await until("duplicate TV folder reports an actionable error", () => phone.execute("return document.querySelector(arguments[0])?.textContent.includes('already a source')", [folderSettings]));
    assert.equal((await sources()).filter(source => source.id === sourceId).length, 1);
    assert.equal((await items())[0]?.id, item.id);
    await closeFolderSources(phone, until);
    await play();
    await httpRemote.screenshot("folder-phone-native-play");
    await stop();
    await rename(path, offline);
    await mkdir(path);
    await openFolderSources(phone, until);
    await action("Test access");
    await ready("unavailable");
    await action("Scan again");
    await ready("unavailable");
    assert.equal((await items())[0]?.id, item.id, "An empty replacement must retain the catalog identity");
    assert.equal((await items())[0]?.available, false);
    await httpRemote.screenshot("folder-unavailable-original-kept");
    await rm(path, { recursive: true });
    await rename(offline, path);
    await action("Test access");
    await ready("ready");
    await action("Scan again");
    await ready("ready");
    assert.equal((await items())[0]?.id, item.id);
    assert.equal((await items())[0]?.available, true);
    await closeFolderSources(phone, until);
    for (const suffix of ["folders", `sources/${sourceId}/test`, `sources/${sourceId}/scan`]) {
      const response = await fetch(`${origin}/api/library/${suffix}`, { method: suffix === "folders" ? "GET" : "POST", headers: { Authorization: `Bearer ${clients[1]!.token}` } });
      assert.equal(response.status, 403, "An ordinary paired controller cannot inspect or mutate TV folders");
    }
    assert.ok(!JSON.stringify(await sources()).includes(path));
    assert.ok(clients.every(client => !JSON.stringify(client.state).includes(path)));
  } finally {
    await restoreQueue();
    await httpRemote.minimize();
  }
  await Bun.write(`${artifactDir}/folder-sources-before-restart.json`, JSON.stringify({ sourceId, itemId: item.id, path, duplicatePreserved: true, missingOriginalKeptCatalog: true, recoveryKeptIdentity: true, environment: "Native Ubuntu Xvfb and real 390px HTTP WebKit phone; physical T480 acceptance remains separate" }, null, 2));
  return {
    async verifyAfterRestart() {
      await httpRemote.restore();
      try {
        assert.ok((await sources()).some(source => source.id === sourceId));
        assert.equal((await items())[0]?.id, item.id);
        await openFolderSources(phone, until);
        await action("Test access");
        await ready("ready");
        await closeFolderSources(phone, until);
        await play();
        const entryId = clients[0]!.state!.currentEntryId!;
        await openFolderSources(phone, until);
        await action("Remove source");
        const confirmation = '[aria-label="Confirm source removal"]';
        assert.ok(await phone.execute("return document.querySelector(arguments[0])?.textContent.includes('Current playback continues')", [confirmation]));
        await phone.button("Remove source, keep files", confirmation);
        await until("phone removal clears only its catalog source", async () => !(await sources()).some(source => source.id === sourceId));
        assert.equal(await Bun.file(`${path}/Folder acceptance.mkv`).exists(), true);
        assert.ok(all(state => state.currentEntryId === entryId && state.player.status === "playing" && state.queue.some(entry => entry.id === entryId)), "Removal keeps current native playback and its queue entry");
        await closeFolderSources(phone, until);
        await stop();
        const history = (await api("/api/progress/history")).items;
        assert.ok(history.some((entry: any) => entry.libraryItemId === item.id), "Source removal retains watching history");
        await clients[0]!.command({ type: "play", entryId });
        await until("a later Play of the removed catalog entry fails safely", () => all(state => state.player.status === "error"));
        await Bun.write(`${artifactDir}/folder-sources-after-restart.json`, JSON.stringify({ sourceId, itemId: item.id, retainedIdentityPlayableAfterRestart: true, removeKeepsFileQueueHistory: true, currentPlaybackContinues: true, laterPlayRejected: true }, null, 2));
      } finally {
        await restoreQueue();
        await httpRemote.minimize();
      }
    },
  };
}
