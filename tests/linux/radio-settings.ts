import { strict as assert } from "node:assert";
import type { RadioPlaylistSummary, RadioStation } from "../../src/shared/radio";
import type { RadioContext } from "./radio";
import { changedRadioTitle, initialRadioTitle, suppliedRadioArtist, type RadioFixture } from "./radio-fixture";
import { assertResponsive } from "./ui";

// Called after administrator claim. All mutations go through the real phone form;
// existing WebSocket controller roles remain unchanged.
export async function verifyRadioSettings({ origin, ui, until, clients, api, httpRemote, artifactDir }: RadioContext, streams: RadioFixture) {
  const phone = httpRemote.ui;
  const originalQueue = structuredClone(clients[0]!.state!.queue);
  const metadata = streams.add("metadata", suppliedRadioArtist);
  const plain = streams.add("plain");
  let revision = 1;
  let mode: "valid" | "malformed" | "unavailable" = "valid";
  const feed = Bun.serve({ hostname: "127.0.0.1", port: 4206, fetch: () => mode === "unavailable" ? new Response("Unavailable", { status: 503 })
    : new Response(mode === "malformed" ? "Not an extended M3U playlist" : `#EXTM3U\n${Array.from({ length: revision + 1 }, (_, index) =>
      `#EXTINF:-1 tvg-id="source-fixture-${index}" tvg-logo="http://127.0.0.1:4200/logo.svg" group-title="Settings stations",Imported station ${index + 1}\n${index === 0 ? metadata.url : plain.url}`,
    ).join("\n")}\n`) });
  const sourceUrl = "http://127.0.0.1:4206/radio.m3u?token=fixture-feed-secret";
  const all = (predicate: (state: NonNullable<typeof clients[number]["state"]>) => boolean) => clients.every(client => !!client.state && predicate(client.state));
  const summaries = async (): Promise<RadioPlaylistSummary[]> => (await api("/api/radio/playlists", undefined, 1)).playlists;
  const stations = async (id: string): Promise<RadioStation[]> => (await api(`/api/radio/playlists/${id}/stations`, undefined, 1)).stations;
  const open = async () => {
    await phone.button("Settings");
    await phone.settingsSection("source-radio");
    await until("Radio opens its one canonical Sources form on the administrator phone", () => phone.execute("return document.querySelectorAll('[data-radio-settings]').length === 1 && !!document.querySelector('#radio-source-name:not(:disabled)')"));
  };
  const close = async () => { await phone.section("Radio"); await phone.type("#media-search", "Imported station"); };
  const importSource = async (name: string, url: string) => {
    await phone.type("#radio-source-name", name);
    await phone.type("#radio-source-url", url);
    await phone.button("Add", "[data-radio-settings]");
    await until("source import completes and restores its form", () => phone.execute("return document.querySelector('#radio-source-name:not(:disabled)')?.value === ''"), 20_000);
  };
  const sourceCard = (id: string) => `[data-radio-source-id="${id}"]`;
  const refresh = async (id: string) => {
    const source = async () => (await api("/api/radio/sources")).sources.find((source: RadioPlaylistSummary) => source.id === id);
    const before = await source();
    await phone.button("Refresh", sourceCard(id));
    await until("source refresh completes", async () => {
      const after = await source();
      return (after.updatedAt !== before.updatedAt || after.error !== before.error) && await phone.execute("return !!document.querySelector('#radio-source-name:not(:disabled)')");
    }, 20_000);
  };
  const stop = async () => {
    await clients[0]!.command({ type: "stop" });
    await until("radio source acceptance stops the native owner and clears track metadata", () => all(state => state.player.status === "idle" && !state.player.nowPlaying));
  };
  let imported!: RadioPlaylistSummary;
  let importedStations: RadioStation[] = [];
  const observations: unknown[] = [];
  try {
    await httpRemote.restore();
    await open();
    await importSource("Fixture radio playlist", sourceUrl);
    imported = (await summaries()).find(source => source.name === "Fixture radio playlist")!;
    assert.ok(imported);
    assert.equal(imported.stationCount, 2);
    assert.equal(JSON.stringify(await summaries()).includes("fixture-feed-secret"), false, "Ordinary browse summaries never disclose the feed token");
    const denied = await fetch(`${origin}/api/radio/sources`, { headers: { authorization: `Bearer ${clients[1]!.token}` } });
    assert.equal(denied.status, 403, "The ordinary controller cannot fetch full source definitions");
    importedStations = await stations(imported.id);
    assert.deepEqual(importedStations.map(station => station.name), ["Imported station 1", "Imported station 2"]);
    assert.ok(importedStations.every(station => station.groupTitle === "Settings stations" && station.logoUrl === "http://127.0.0.1:4200/logo.svg"));
    await assertResponsive(phone, "Phone radio Sources import");
    await httpRemote.screenshot("radio-sources-imported");
    await importSource("Fixture radio playlist", `${sourceUrl}#ignored`);
    assert.equal((await summaries()).filter(source => source.id === imported.id).length, 1, "Duplicate imports preserve the original source identity");
    assert.deepEqual((await stations(imported.id)).map(station => station.id), importedStations.map(station => station.id));
    await close();
    await phone.button("Play Imported station 1", '[aria-label="Search results"]');
    await until("imported playlist Play reaches the one native owner with observed current-track metadata", () => all(state => state.player.status === "playing" && state.queue.find(entry => entry.id === state.currentEntryId)?.source === `radio:${importedStations[0]!.id}` && state.player.nowPlaying?.title === initialRadioTitle && state.player.nowPlaying.artist === suppliedRadioArtist), 20_000);
    observations.push({ phase: "imported playback", player: clients[0]!.state!.player });
    await phone.button("Save: Imported station 1", '[aria-label="Search results"]');
    await until("imported favorite is available to ordinary controllers", async () => (await api("/api/radio/favorites", undefined, 1)).favorites.some((station: RadioStation) => station.id === importedStations[0]!.id));
    streams.setTitle(metadata.key, changedRadioTitle);
    await until("the imported stream updates current-track metadata without changing station identity", () => all(state => state.player.nowPlaying?.title === changedRadioTitle && state.queue.find(entry => entry.id === state.currentEntryId)?.title === "Imported station 1"), 15_000);
    await httpRemote.screenshot("radio-sources-observed-track");
    await stop();
    await until("Stop closes the imported native HTTP stream", () => streams.requests(metadata.key).every(request => !!request.closedAt));
    await open();
    revision = 2;
    await refresh(imported.id);
    assert.equal((await stations(imported.id)).length, 3);
    assert.equal((await stations(imported.id))[0]!.id, importedStations[0]!.id, "Refresh retains stable station identities");
    for (const failure of ["unavailable", "malformed"] as const) {
      mode = failure;
      await refresh(imported.id);
      assert.equal((await stations(imported.id)).length, 3, "Failed refresh retains the previously imported catalog");
      assert.equal(await phone.execute("return !!document.querySelector('[data-radio-settings] [role=alert]')?.textContent.trim()"), true, "Failed refresh reports an error while the cached catalog stays playable");
      observations.push({ phase: failure, source: (await summaries()).find(source => source.id === imported.id) });
    }
    await httpRemote.screenshot("radio-sources-cached-failure");
    mode = "valid";
    await refresh(imported.id);
    assert.equal((await summaries()).find(source => source.id === imported.id)!.error, null);
    await importSource("Temporary source", "http://127.0.0.1:4206/temporary.m3u");
    const temporary = (await summaries()).find(source => source.name === "Temporary source")!;
    await phone.button("Remove", sourceCard(temporary.id));
    assert.equal(await phone.execute("return document.querySelector('[role=alertdialog]').textContent.includes('Saved stations stay')"), true);
    await phone.button("Cancel", "[role=alertdialog]");
    assert.ok((await summaries()).some(source => source.id === temporary.id));
    await phone.button("Remove", sourceCard(temporary.id));
    await phone.button("Remove", "[role=alertdialog]");
    await until("confirmed removal deletes only the selected source", async () => !(await summaries()).some(source => source.id === temporary.id));
    assert.ok((await api("/api/radio/favorites")).favorites.some((station: RadioStation) => station.id === importedStations[0]!.id), "Source removal retains unrelated favorites");
    await close();
    await phone.button("Play Imported station 1", '[aria-label="Search results"]');
    await until("cached imported station plays after source administration", () => all(state => state.player.status === "playing" && state.player.nowPlaying?.title === changedRadioTitle), 20_000);
    await phone.button("Play Imported station 2", '[aria-label="Search results"]');
    await until("source replacement closes the imported stream and clears its current track", () => all(state => state.player.status === "playing" && !state.player.nowPlaying && state.queue.find(entry => entry.id === state.currentEntryId)?.source === `radio:${importedStations[1]!.id}`) && streams.requests(metadata.key).every(request => !!request.closedAt), 20_000);
    await stop();
    await ui.section("Radio");
    await ui.type("#media-search", "Imported station");
    await until("native Find receives the imported stations", () => ui.execute("return [...document.querySelectorAll('[aria-label=\"Search results\"] button[aria-label^=\"Play Imported station\"]')].length === 3"));
    if (process.env.COUCH_TEST_LIVE_RADIO === "1") {
      await open();
      await phone.button("Refresh", "[data-avoid-radio]");
      await until("one-step avoid import completes in Sources", () => phone.execute("return !!document.querySelector('#radio-source-name:not(:disabled)')"), 20_000);
      const avoid = (await summaries()).find(source => source.name === "avoid radio")!;
      assert.ok(avoid, "The actual avoid radio source imports");
      const liveStations = await stations(avoid.id);
      assert.deepEqual(liveStations.map(station => station.name), ["Sygma Radio", "Lyl Radio", "Cashmere Radio", "NTS Radio | Channel 1", "NTS Radio | Channel 2", "Resonance Extra", "Internet Public Radio", "HKCR", "Radio Alhara", "Radio BlackOut"]);
      assert.ok(liveStations.every(station => station.groupTitle === "avoid radio" && station.logoUrl?.startsWith("https://") && station.tvgId?.startsWith("avoid-radio-")));
      await close();
      await phone.type("#media-search", liveStations[0]!.name);
      await phone.button("avoid radio", '[aria-label="Filter search results"]');
      await phone.button(`Play ${liveStations[0]!.name}`, '[aria-label="Search results"]');
      await until("the actual avoid station imported in Sources plays through the native owner", () => all(state => state.player.status === "playing" && state.player.position > 2 && state.queue.find(entry => entry.id === state.currentEntryId)?.source === `radio:${liveStations[0]!.id}`), 30_000);
      observations.push({ phase: "live avoid radio", feed: "https://radio.avoid.quest/playlist.m3u", station: liveStations[0], observed: clients[0]!.state!.player.nowPlaying ?? null });
      await httpRemote.screenshot("radio-sources-live-avoid");
      await stop();
    }
  } finally {
    await stop();
    for (const entry of [...clients[0]!.state!.queue]) if (!originalQueue.some(original => original.id === entry.id)) await clients[0]!.command({ type: "remove", entryId: entry.id });
    await until("radio Sources acceptance restores the original queue identities and order", () => all(state => JSON.stringify(state.queue.map(entry => entry.id)) === JSON.stringify(originalQueue.map(entry => entry.id))));
    await Bun.write(`${artifactDir}/radio-sources.json`, JSON.stringify({ source: imported, stationIds: importedStations.map(station => station.id), observations, requests: streams.requests(metadata.key) }, null, 2));
    await feed.stop(true);
    await httpRemote.minimize();
  }
  return {
    async verifyAfterRestart() {
      assert.equal((await stations(imported.id)).length, 3, "Imported source catalog survives desktop restart");
      assert.ok((await api("/api/radio/favorites", undefined, 1)).favorites.some((station: RadioStation) => station.id === importedStations[0]!.id), "Imported favorite survives desktop restart");
      assert.equal((await summaries()).find(source => source.id === imported.id)?.name, "Fixture radio playlist");
    },
  };
}
