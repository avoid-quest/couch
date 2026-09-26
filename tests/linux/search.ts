import { strict as assert } from "node:assert";
import type { JellyfinItems } from "../../src/shared/jellyfin";
import type { LibrarySearch } from "../../src/shared/library";
import { musicControls, restoreQueue, type MusicContext } from "./music";
import { assertResponsive, keys, type UiDriver } from "./ui";

// Run after the disposable fixture has scanned playable local media and connected
// its actual Jellyfin server. This journey does not install or configure sources.
export async function verifySearch(context: MusicContext) {
  const { ui, httpRemote, api, until } = context;
  const { first, all, stop } = musicControls(context);
  const originalQueue = [...first().queue];
  const local = (await api("/api/library/items?limit=100") as LibrarySearch).items.find(item => item.available);
  const jellyfin = (await api("/api/jellyfin/items") as JellyfinItems).items[0];
  assert.ok(local, "Search qualification needs scanned playable local media");
  assert.ok(jellyfin, "Search qualification needs an actual connected Jellyfin catalog");
  const outcomes: unknown[] = [];
  async function query(driver: UiDriver, text: string) {
    await driver.section("Search");
    await driver.type("#media-search", text);
    await driver.button("Search", '[aria-label="Search media"] form');
  }
  try {
    await stop();
    for (const [name, driver] of [["TV", ui], ["phone", httpRemote.ui]] as const) {
      if (name === "TV") await httpRemote.minimize(); else await httpRemote.restore();
      for (const [source, item] of [["Library", local], ["Jellyfin", jellyfin]] as const) {
        const scope = '[aria-label="Search results"]';
        const opener = `${scope} [aria-label=${JSON.stringify(`Details: ${item.title}`)}]`;
        await query(driver, item.title);
        await until(`${name} finds ${source} item by title in shared Search`, () => driver.execute("return !!document.querySelector(arguments[0]) && ![...document.querySelectorAll('[role=status]')].some(line => line.textContent.startsWith('Still asking'))", [opener]));
        await driver.click(opener);
        const scrollPosition = await driver.execute("const panel = document.querySelector('[aria-label=\"Search media\"]'); const scroller = panel.closest('.tv-browser') || document.scrollingElement; return [scroller.scrollTop, scroller.scrollLeft]") as number[];
        const count = first().queue.length;
        const prefix = source === "Library" ? `library:${item.id}` : `:${item.id}`;
        await driver.button(`Queue ${item.title}`, '[role="dialog"]');
        await until(`${name} Search queue appends the ${source} item for both controllers`, () => all(state => state.queue.length === count + 1 && state.queue.at(-1)?.source.endsWith(prefix) === true));
        const previous = first().player.playbackId;
        await driver.click('[role="dialog"] button[aria-label^="Play: "], [role="dialog"] button[aria-label^="Resume: "]');
        await until(`${name} Search ${source} play reaches native player and both controllers`, () => all(state => state.player.status === "playing" && state.player.playbackId !== previous && state.queue.find(entry => entry.id === state.currentEntryId)?.source.endsWith(prefix) === true));
        await context.clients[1]!.command({ type: "pause", playbackId: first().player.playbackId!, paused: true });
        await until(`${name} Search playback pauses through the other paired controller`, () => all(state => state.player.status === "paused"));
        await until(`${name} Search details survive the playback progress broadcast`, () => driver.execute("return document.querySelector('[role=dialog]')?.textContent.includes(arguments[0])", [item.title]));
        await driver.key(keys.escape);
        await until(`${name} Search details return directional focus to ${source} result`, () => driver.execute("return !document.querySelector('[role=dialog]') && document.activeElement === document.querySelector(arguments[0])", [opener]));
        const returnedScroll = await driver.execute("const panel = document.querySelector('[aria-label=\"Search media\"]'); const scroller = panel.closest('.tv-browser') || document.scrollingElement; return [scroller.scrollTop, scroller.scrollLeft]") as number[];
        assert.deepEqual(returnedScroll, scrollPosition, `${name} details retain actual WebKit scroll offsets`);
        await driver.section("Queue"); await driver.section("Search");
        assert.equal(await driver.execute("return document.querySelector('#media-search').value"), item.title);
        if (name === "phone") await assertResponsive(driver, `${name} Search ${source}`);
        else assert.equal(await driver.execute("return document.documentElement.scrollWidth > innerWidth + 1"), false, "TV Search has no page overflow");
        outcomes.push({ device: name, source, itemId: item.id, title: item.title, playbackId: first().player.playbackId });
        await stop();
      }
    }
    await Bun.write(`${context.artifactDir}/search-journey.json`, JSON.stringify(outcomes, null, 2));
    await httpRemote.screenshot("search-phone.png");
  } catch (error) {
    await Bun.write(`${context.artifactDir}/search-focus-diagnostic.json`, JSON.stringify(await ui.execute("return {active:{tag:document.activeElement?.tagName,id:document.activeElement?.id,label:document.activeElement?.getAttribute('aria-label')},browserHidden:document.querySelector('.tv-browser')?.hidden,dialog:!!document.querySelector('[role=dialog]')}"), null, 2));
    throw error;
  } finally {
    await httpRemote.minimize();
    await restoreQueue(context, originalQueue);
  }
}
