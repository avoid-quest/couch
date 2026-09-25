import { strict as assert } from "node:assert";
import { musicControls, restoreQueue, type MusicContext } from "./music";
import { assertResponsive } from "./ui";

// Runs in the existing disposable Search fixture, against native libmpv and its paired HTTP browser.
export async function verifyAcceptedUx(context: MusicContext) {
  const { ui, httpRemote, clients, api, until, artifactDir } = context;
  const { first, all, stop } = musicControls(context);
  const originalQueue = structuredClone(first().queue), originalProfile = first().activeProfile;
  const item = (await api("/api/library/items?limit=100")).items.find((item: { title: string; available: boolean }) => item.available && item.title === "Search local video");
  assert.ok(item, "Accepted UX uses the scanned Search video");
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  let profile: { id: string; name: string } | undefined;
  try {
    await restoreQueue(context, []);
    for (const entryId of ids) await clients[0]!.command({ type: "enqueueLibrary", entryId, itemId: item.id });
    await until("three real local entries reach both controllers", () => all(state => state.queue.length === 3));
    await clients[0]!.command({ type: "play", entryId: ids[1]!, fromStart: true });
    await until("middle queue item plays in native libmpv", () => all(state => state.currentEntryId === ids[1] && state.player.status === "playing" && state.player.seekable));
    await clients[1]!.command({ type: "pause", playbackId: first().player.playbackId!, paused: true });
    await until("paired controller pauses the accepted UX fixture", () => all(state => state.player.status === "paused"));
    for (const [name, driver] of [["TV", ui], ["phone", httpRemote.ui]] as const) {
      if (name === "phone") await httpRemote.restore(); else await httpRemote.minimize();
      await driver.section("Queue");
      await until(`${name} separates current, next and played queue entries`, () => driver.execute(`
        const ids = label => [...document.querySelectorAll('.queue-panel [aria-label="' + label + '"] [data-queue-entry-id]')].map(row => row.dataset.queueEntryId);
        return document.querySelector('.player-band-heading h1')?.textContent === 'Search local video'
          && JSON.stringify([ids('Up next'), ids('Played')]) === JSON.stringify([[arguments[0]], [arguments[1]]]);
      `, [ids[2], ids[0]]));
      if (name === "phone") { await assertResponsive(driver, "Phone current session"); await httpRemote.screenshot("accepted-current-session"); }
    }
    await httpRemote.minimize();
    await clients[0]!.command({ type: "seek", playbackId: first().player.playbackId!, position: 12 });
    await until("native resume checkpoint reaches twelve seconds", () => all(state => Math.abs(state.player.position - 12) < 0.5));
    const checkpointPlaybackId = first().player.playbackId;
    const checkpointSource = first().queue.find(entry => entry.id === first().currentEntryId)!.source;
    await stop();
    await ui.section("Home");
    await until("TV Browse offers the real unfinished local item", () => ui.execute("return !!document.querySelector('[aria-label=\"Browse and resume\"] [aria-label=\"Resume Search local video\"]')"));
    await ui.button("Resume Search local video", '[aria-label="Continue watching"]');
    await until("TV Browse starts a new native playback", () => first().player.status === "playing" && !!first().player.playbackId && first().player.playbackId !== checkpointPlaybackId);
    const resumed = structuredClone(first());
    assert.equal(resumed.queue.find(entry => entry.id === resumed.currentEntryId)?.source, checkpointSource, "Browse resumes the checkpoint's local source");
    assert.ok(resumed.player.position >= 11.5 && resumed.player.position < 14, `First observed native playback starts near the saved twelve-second point: ${resumed.player.position}`);
    await clients[1]!.command({ type: "pause", playbackId: resumed.player.playbackId!, paused: true });
    await until("both controllers pause the same resumed native playback", () => all(state => state.player.playbackId === resumed.player.playbackId && state.currentEntryId === resumed.currentEntryId && state.player.status === "paused"));
    await Bun.write(`${artifactDir}/accepted-resume.json`, JSON.stringify({ checkpointSource, checkpointPlaybackId, firstPlaying: resumed.player, resumedEntryId: resumed.currentEntryId }, null, 2));
    await stop();
    await ui.section("Library");
    await ui.type("#media-search", "Search local video");
    await ui.button("Save Search local video for later", '[aria-label="Search results"]');
    await until("native For later save reaches the paired HTTP API", async () => (await api("/api/for-later", undefined, 1)).items.some((saved: any) => saved.title === item.title));
    await ui.section("Queue");
    await ui.button("Keep as a list", ".queue-panel");
    await until("native playlist save reaches the paired HTTP API", async () => (await api("/api/playlists", undefined, 1)).playlists.some((saved: any) => saved.name.startsWith("Up next,")));
    const savedItems = await api("/api/for-later"), savedPlaylists = await api("/api/playlists");
    const queueIds = first().queue.map(entry => entry.id);
    profile = (await api("/api/profiles", { name: `Accepted UX ${crypto.randomUUID().slice(0, 8)}` })).profile;
    await api(`/api/profiles/${profile!.id}/select`, {}, 1);
    await until("both paired controllers select the alternate watching profile", () => all(state => state.activeProfile.id === profile!.id));
    assert.deepEqual(await api("/api/for-later", undefined, 1), savedItems, "For later stays shared across profiles");
    assert.deepEqual(await api("/api/playlists", undefined, 1), savedPlaylists, "Reusable playlists stay shared across profiles");
    assert.ok(all(state => state.player.status === "idle" && JSON.stringify(state.queue.map(entry => entry.id)) === JSON.stringify(queueIds)), "Profile selection preserves the shared queue without starting playback");
    for (const [name, driver] of [["TV", ui], ["phone", httpRemote.ui]] as const) {
      if (name === "phone") await httpRemote.restore(); else await httpRemote.minimize();
      await driver.section("For later");
      await until(`${name} sees the saved item under the alternate profile`, () => driver.execute("return document.querySelector('[aria-label=\"Saved for later\"]')?.textContent.includes('Search local video')"));
      await driver.button("Settings");
      await until(`${name} offers grouped Settings pages`, () => driver.execute("return !!document.querySelector('[aria-label=\"Settings pages\"] [data-settings-page=playback]') && !!document.querySelector('[aria-label=\"Settings pages\"] [data-settings-page=general]')"));
      for (const section of ["playback", "appearance", "general"]) await driver.settingsSection(section);
      if (name === "phone") { await assertResponsive(driver, "Phone Settings ownership groups"); await httpRemote.screenshot("accepted-settings-groups"); }
    }
    await Bun.write(`${artifactDir}/accepted-ux.json`, JSON.stringify({ nativePlayback: "saved local checkpoint resumed", queue: "current/up next/played on TV and HTTP phone", shared: { forLater: savedItems, playlists: savedPlaylists }, settings: ["Playback", "Library", "Connections", "System"], browser: "Linux WebKitGTK at 390px; physical Mac and phone remain separate acceptance" }, null, 2));
  } finally {
    await httpRemote.minimize();
    await stop();
    await api(`/api/profiles/${originalProfile.id}/select`, {});
    if (profile) await api(`/api/profiles/${profile.id}/remove`, { expectedName: profile.name });
    await restoreQueue(context, originalQueue);
  }
}
