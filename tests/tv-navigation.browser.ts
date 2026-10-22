// Run in an isolated paired TV renderer with paused seekable video, two saved videos,
// two radio favorites, a Live TV fixture and a second online shared output. Reload
// before each run so the second Saved item has not already loaded its Details.
// See docs/native-tv.md for the browser regression command and prerequisites.
import { applyTvNavigation } from "../src/client/navigation";

declare global {
  interface Window {
    runSavedBackRegression: () => Promise<{ name: string; passed: boolean; error?: string }[]>;
    runSharingLocalOnlyRegression: () => Promise<{ name: string; passed: boolean; error?: string }[]>;
    runTvNavigationRegression: () => Promise<{ name: string; passed: boolean; error?: string }[]>;
  }
}

const wait = (milliseconds = 150) => new Promise(resolve => setTimeout(resolve, milliseconds));
const until = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 40; attempt++) { if (condition()) return; await wait(100); }
  throw new Error("Fixture did not settle");
};
const control = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
};
const key = async (key: string) => {
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key, code: key === " " ? "Space" : key, bubbles: true, cancelable: true }));
  await wait();
};
const click = async (selector: string) => { const element = control(selector); element.focus(); element.click(); await wait(350); };
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

// Delay only the real response; the cold test uses the second, not-yet-opened item.
const savedBack = async (cold: boolean) => {
  await click('[data-app-nav] a[href="/"]');
  await click('[data-app-nav] a[href="/saved"]');
  assert(document.activeElement?.matches('nav[aria-label="Saved sections"] [aria-current="page"]'), "Direct Saved entry lost the rail");
  const rows = [...document.querySelectorAll<HTMLElement>('[data-saved-details]')];
  assert(rows.length >= 2, "Save two video fixtures before running");
  const button = rows[1]!.querySelector<HTMLElement>('button[aria-label^="Details"]')!;
  const label = button.getAttribute("aria-label");
  const previousLabel = rows[0]!.querySelector('button[aria-label^="Details"]')!.getAttribute("aria-label");
  const id = rows[1]!.dataset.savedDetails;
  const originalFetch = window.fetch;
  let delayed = 0;
  if (cold) window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (new URL(String(args[0]), location.href).pathname === "/api/for-later") { delayed++; await wait(800); }
    return response;
  };
  try {
    button.focus(); button.click();
    await until(() => location.pathname === "/item" && !!document.querySelector('[data-page="Item"] button[aria-label^="Options"]'));
    await wait(350);
    assert(!cold || delayed > 0, "Cold Saved check did not reach the real request; reload before running");
    assert(document.activeElement?.closest('[data-page="Item"]'), "Loaded Saved Details lost page focus");
    await key("Escape");
    await until(() => location.pathname === "/saved");
    await wait(350); // Catch a later mount frame overwriting a briefly correct restoration.
    const restored = document.activeElement as HTMLElement;
    assert(restored?.getAttribute("aria-label") === label && !restored.matches(':disabled, [aria-disabled="true"]')
      && !restored.closest('[inert], [aria-hidden="true"]') && restored.getClientRects().length > 0, "Saved Back did not retain its enabled visible item opener after settling");
    await key("ArrowUp");
    assert(document.activeElement?.getAttribute("aria-label") === previousLabel, "Next arrow did not continue from the restored Saved item");
    await key("ArrowDown");
    assert(document.activeElement?.getAttribute("aria-label") === label, "Down did not return to the restored Saved item");
    await click(`[data-saved-details="${id}"] button[aria-label^="Details"]`);
    await key("Escape"); await wait(350);
    assert(document.activeElement?.getAttribute("aria-label") === label, "Repeated Saved Back lost its opener");
  } finally {
    window.fetch = originalFetch;
    await click('[data-app-nav] a[href="/"]');
  }
};

window.runSavedBackRegression = async () => {
  const results: { name: string; passed: boolean; error?: string }[] = [];
  for (const cold of [true, false]) {
    const name = `${cold ? "Cold delayed" : "Warm"} Saved Back retains its item opener`;
    try { await savedBack(cold); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: String(error) }); }
  }
  return results;
};

// A paired phone's Remote reaches the TV through applyTvNavigation; it must not pick or share
// this device's capture, while the TV's own keyboard and pointer still can.
const sharingLocalOnly = async () => {
  await click('[data-app-nav] a[href="/settings"]');
  await click('[data-settings-page="device"]');
  const choice = (label: string) => [...document.querySelectorAll<HTMLElement>('[aria-label="What to share"] [role="radio"]')].find(item => item.textContent === label);
  const microphone = choice("Microphone or audio input"), screen = choice("Screen");
  assert(microphone && screen && !microphone.matches(":disabled"), "Sharing has no enabled capture choices; stop any existing capture first");
  assert(screen!.getAttribute("aria-checked") === "true", "Sharing did not start on Screen");
  const remote = async (key: Parameters<typeof applyTvNavigation>[0]) => { applyTvNavigation(key); await wait(350); };
  try {
    microphone!.focus();
    await remote("select");
    assert(microphone!.getAttribute("aria-checked") !== "true", "Remote OK chose what this device shares");
    await remote("down");
    assert(!microphone!.closest("fieldset")!.contains(document.activeElement), "Remote arrows stayed in this device's capture");
    microphone!.click(); await wait(350);
    assert(microphone!.getAttribute("aria-checked") === "true", "This device's own pointer could not choose the input");
    control("#live-audio-input").focus(); await key("Enter"); await wait(350);
    const listbox = control('[role="listbox"][data-state="open"]');
    const option = document.activeElement;
    await remote("down"); await remote("select");
    assert(listbox.isConnected && document.activeElement === option, "Remote moved or picked in this device's audio input list");
    await key("Escape"); await wait(350);
    assert(!document.querySelector('[role="listbox"][data-state="open"]'), "This device's own Back did not close its audio input list");
  } finally {
    screen!.click(); await wait(350);
    await click('[data-app-nav] a[href="/"]');
  }
};

window.runSharingLocalOnlyRegression = async () => {
  try { await sharingLocalOnly(); return [{ name: "Remote can't drive this device's capture", passed: true }]; }
  catch (error) { return [{ name: "Remote can't drive this device's capture", passed: false, error: String(error) }]; }
};


window.runTvNavigationRegression = async () => {
  const results: { name: string; passed: boolean; error?: string }[] = [];
  const check = async (name: string, test: () => Promise<void>) => {
    try { await test(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: String(error) }); }
  };
  await check("Home media have one focus stop and TV identity is plain text", async () => {
    await click('[data-app-nav] a[href="/"]');
    const items = [...document.querySelectorAll('[aria-label="Radio stations"] li')];
    assert(items.length > 0, "Radio fixture missing");
    // A tile's "…" is no stop on the TV (tabindex -1); a held OK opens its menu.
    assert(items.every(item => item.querySelectorAll('button:not(:disabled):not([tabindex="-1"]), a[href]').length === 1), "Radio has multiple stops per item");
    assert(!document.querySelector('.app-header [data-slot="popover-trigger"]:not([data-live-sharing] *)'), "TV header still has Couch switch");
  });
  await check("A held OK opens a Home tile's menu, Back returns to the tile, a short OK acts on release, and the Remote's hold does the same", async () => {
    await click('[data-app-nav] a[href="/"]');
    const tile = control('[aria-label="Radio stations"] [data-media-tile][data-item-menu]:not(:disabled)');
    const ok = (type: "keydown" | "keyup", repeat = false) => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", repeat, bubbles: true, cancelable: true }));
    const menu = () => document.querySelector('[role="menu"]');
    tile.focus(); ok("keydown"); await wait(700);
    assert(menu() && document.activeElement?.closest('[role="menu"]'), "A held OK did not open the tile's menu on its first verb");
    assert([...menu()!.querySelectorAll('[role="menuitem"]')].some(item => item.textContent === "Queue"), "The station's menu lacks Queue");
    ok("keydown", true); ok("keyup"); await wait(150);
    assert(menu(), "The held OK's repeat or release acted in the menu");
    await key("Escape"); await wait(350);
    assert(!menu() && document.activeElement === tile, "Back did not close the menu onto its tile");
    // The tile's press is caught here, so the fixture keeps playing what it plays.
    let pressed = 0;
    const press = (event: Event) => { pressed++; event.preventDefault(); event.stopPropagation(); };
    tile.addEventListener("click", press, true);
    try {
      ok("keydown"); await wait(100);
      assert(!pressed && !menu(), "OK acted before its release");
      ok("keyup"); await wait(150);
      assert(pressed === 1 && !menu(), "A short OK did not act once on release");
    } finally { tile.removeEventListener("click", press, true); }
    applyTvNavigation("menu"); await wait(350);
    assert(menu(), "The Remote's held OK did not open the tile's menu");
    applyTvNavigation("back"); await wait(350);
    assert(!menu() && document.activeElement === tile, "The Remote's Back did not close the menu onto its tile");
  });
  await check("Details from a Home tile's menu keeps Home, and Back returns to the tile", async () => {
    await click('[data-app-nav] a[href="/"]');
    const tile = control('[aria-label="Radio stations"] [data-media-tile][data-item-menu]:not(:disabled)');
    const label = tile.getAttribute("aria-label");
    tile.focus(); applyTvNavigation("menu"); await wait(350);
    assert(document.activeElement?.textContent === "Details", "The station's menu did not start on Details");
    applyTvNavigation("select");
    await until(() => location.pathname === "/item");
    assert(new URLSearchParams(location.search).get("from") === "home" && document.querySelector('.app-header [aria-current="page"][href="/"]'), "Details from Home's menu left Home");
    await key("Escape");
    await until(() => location.pathname === "/" && document.activeElement?.getAttribute("aria-label") === label).catch(() => { throw new Error("Back did not return to the tile"); });
  });
  await check("Home starts on the hero's primary verb, and Up from its last shelf passes each shelf and the hero to the current tab", async () => {
    await click('[data-app-nav] a[href="/saved"]');
    await click('[data-app-nav] a[href="/"]');
    const hero = control("[data-home-hero]");
    assert(document.activeElement === hero.querySelector("[data-page-first]"), "Home entry did not focus the hero's primary verb");
    const shelves = [...document.querySelectorAll<HTMLElement>('[data-page="Home"] ol[data-nav-row]')];
    assert(shelves.length >= 1 && document.querySelector('[data-home-board] li[data-nav-row]'), "Home needs a board row and a shelf (the saved videos and Radio)");
    shelves.at(-1)!.querySelector<HTMLElement>("button")!.focus();
    const passed: Element[] = [];
    for (let step = 0; step < 12 && !document.activeElement?.closest(".app-header"); step++) {
      await key("ArrowUp");
      const at = document.activeElement?.closest('[data-page="Home"] ol[data-nav-row], [data-home-hero]');
      if (at && passed.at(-1) !== at) passed.push(at);
    }
    const expected = [...shelves.slice(0, -1).reverse(), hero];
    // A shelf's heading, which opens its whole list, is a stop between it and the shelf above.
    assert(passed.length === expected.length && passed.every((element, index) => element === expected[index]), "Up skipped a shelf or the hero, or met another control");
    assert(document.activeElement?.matches('.app-header a[aria-current="page"][href="/"]'), "Up from the hero did not reach the current tab");
  });
  await check("Up and Down leave a shelf, for its heading or the next shelf, beside a tile whose caption is shorter or taller", async () => {
    await click('[data-app-nav] a[href="/"]');
    const [upper, lower] = [...document.querySelectorAll<HTMLElement>('[data-page="Home"] ol[data-nav-row]')].slice(-2);
    const tiles = (shelf?: HTMLElement) => [...shelf?.querySelectorAll<HTMLElement>("[data-media-tile]") ?? []];
    assert(tiles(upper).length >= 2 && tiles(lower).length >= 2, "Home needs two shelves of two tiles (the saved videos and Radio)");
    // A longer caption (a two-line title) moves a tile's centre off its neighbour's.
    // Between the two shelves sits the lower one's heading, when it opens a list.
    const heading = lower!.closest("section")?.querySelector<HTMLElement>("header a[href]");
    const leave = async (from: HTMLElement, taller: HTMLElement, direction: string, into: HTMLElement) => {
      const caption = taller.querySelector<HTMLElement>("[data-tile-caption]")!;
      caption.style.paddingBottom = "3rem";
      try { from.focus(); await key(direction); } finally { caption.style.paddingBottom = ""; }
      assert(document.activeElement === heading || into.contains(document.activeElement), `${direction} moved along its shelf or skipped the next`);
    };
    await leave(tiles(lower).at(-1)!, tiles(lower).at(-1)!, "ArrowUp", upper!);
    await leave(tiles(upper).at(-1)!, tiles(upper).at(-2)!, "ArrowDown", lower!);
  });
  await check("Settings OK enters content; Back restores rail then Home", async () => {
    await click('[data-app-nav] a[href="/settings"]');
    const rail = control('[data-settings-page="devices"]');
    rail.focus(); rail.click(); await wait(350);
    assert(document.activeElement?.closest('[data-settings-content]'), "OK lost content focus");
    assert(document.activeElement?.textContent === "Pair a device", "Devices did not begin on Pair a device");
    (document.activeElement as HTMLElement).click(); await wait(350);
    assert(document.querySelector('[role="dialog"][data-state="open"]'), "Pairing overlay did not open");
    await key("Escape"); await wait(350);
    assert(!document.querySelector('[role="dialog"][data-state="open"]'), "Back did not close pairing overlay");
    assert(location.pathname === "/settings/couch/devices" && document.activeElement?.textContent === "Pair a device", "Overlay Back did not return to its opener");
    await key("Escape");
    assert(document.activeElement?.matches('[data-settings-page="devices"]'), "Back did not restore rail");
    await key("Escape");
    assert(location.pathname === "/", "Rail Back did not reach Home");
  });
  await check("Remote can't drive this device's capture", sharingLocalOnly);
  await check("Cold delayed Saved Back retains its item opener", () => savedBack(true));
  await check("Warm Saved Back retains its item opener", () => savedBack(false));
  await check("Saved Home tile opens Details on its primary verb, walks its verbs with Right and restores its opener", async () => {
    const tile = control('[data-saved-details] button');
    const label = tile.getAttribute("aria-label");
    assert(tile.closest("li")?.querySelectorAll('button:not(:disabled):not([tabindex="-1"]),a[href]').length === 1, "Saved media has multiple stops");
    tile.focus(); tile.click();
    await until(() => location.pathname === "/item" && !!document.querySelector('[data-page="Item"] h1'));
    await wait(350);
    assert(document.activeElement?.matches('[data-page="Item"] header [data-page-first]') && document.activeElement.textContent === "Play", "Loaded Details did not start on Play");
    const verbs = [...document.querySelectorAll<HTMLElement>('[data-page="Item"] header [data-nav-row] button:not(:disabled)')];
    assert(verbs.map(verb => verb.textContent || verb.getAttribute("aria-label")).join(", ").startsWith("Play, Queue"), "Saved Details lacks Play and Queue in its row");
    for (const verb of verbs.slice(1)) {
      await key("ArrowRight");
      assert(document.activeElement === verb, "Right skipped a Details verb");
    }
    await key("Escape");
    await until(() => location.pathname === "/" && document.activeElement?.getAttribute("aria-label") === label);
    assert(document.activeElement?.closest('[data-saved-details]'), "Details Back lost Home tile focus");
  });
  await check("TV HUD hides, seeks ten seconds and returns to opener without a Home cycle", async () => {
    await click('[data-app-nav] a[href="/saved"]');
    await click('[data-now-playing] button[aria-label^="Open player:"]');
    const video = document.querySelector('video')!;
    await until(() => video.readyState >= 2 && video.duration > 20);
    await until(() => !!document.querySelector('.player-page [data-play-button]:not(:disabled)'));
    const pause = document.querySelector<HTMLButtonElement>('.player-page [data-play-button][aria-label="Pause"]');
    if (pause && !pause.disabled) { pause.click(); await until(() => video.paused); }
    assert(video.paused && video.duration > 20, "Pause a seekable video fixture before running");
    assert(!document.querySelector('[data-player-header], .player-page button[aria-label="Enter fullscreen"]'), "TV still has desktop chrome");
    assert(document.querySelector('[data-player-tools] span[data-player-last]'), "TV lost fullscreen's empty slot");
    await key("Escape");
    assert(control('[data-player-band]').getAttribute('data-player-band') === "hidden", "Back left instead of hiding HUD");
    const before = video.currentTime;
    await key("ArrowRight"); await wait(500);
    assert(video.currentTime >= before + 8 && video.currentTime <= before + 12, "Hidden Right did not seek ten seconds");
    assert(document.activeElement?.getAttribute('aria-label') === "Playback position", "Hidden Right did not focus timeline");
    // The gear ends the TV's tools: it has no fullscreen, and fullscreen's empty slot is no stop for the remote.
    const gear = control('[data-player-tools] button[aria-label="Playback"]');
    gear.focus(); await key("ArrowRight");
    assert(document.activeElement === gear, "Right left the gear for fullscreen's empty slot");
    control('[role="slider"][aria-label="Playback position"]').focus();
    await key("Escape"); await key("Escape");
    assert(location.pathname === "/saved", "Player did not return to its opener");
    await key("Escape"); await key("Escape"); await key("Escape");
    assert(location.pathname === "/", "Back on Home reopened player");
  });
  await check("Up next and Details preserve the player's opener and focus", async () => {
    await click('[data-app-nav] a[href="/saved"]');
    await click('[data-now-playing] button[aria-label^="Open player:"]');
    await click('.player-page button[aria-label="Up next"]');
    assert(location.search.includes("queue=true"), "Queue URL did not open");
    await key("Escape");
    assert(!location.search.includes("queue=true") && document.activeElement?.getAttribute("aria-label") === "Up next", "Queue Back lost trigger focus");
    await click('.player-page button[aria-label="Playback"]');
    const entryHref = control('[data-player-menu] a[href^="/item"]').getAttribute("href");
    await click('[data-player-menu] a[href^="/item"]');
    assert(location.pathname === "/item", "Details did not open");
    assert(document.activeElement?.closest('[data-page="Item"]'), "Details lost page-entry focus");
    await key("Escape");
    assert(location.pathname === "/now", "Details Back skipped player");
    await wait(350);
    assert(document.activeElement?.getAttribute("aria-label") === "Playback", "Details Back lost Playback opener focus");
    assert(document.querySelector('video')?.paused && document.querySelector('.player-page [data-play-button][aria-label="Play"]'), "Details Back changed paused playback");
    (document.activeElement as HTMLElement).click(); await wait(350);
    assert(document.querySelector('[data-player-menu]') && document.querySelector('video')?.paused, "Immediate OK resumed instead of opening Playback");
    assert(control('[data-player-menu] a[href^="/item"]').getAttribute("href") === entryHref, "Details Back changed the played entry");
    await key("Escape"); await wait(350);
    assert(document.activeElement?.getAttribute("aria-label") === "Playback", "Playback Back lost opener focus");
    await key("Escape"); await key("Escape");
    assert(location.pathname === "/saved", "Queue URL or Details lost original opener");
    await key("Escape"); await key("Escape");
    assert(location.pathname === "/", "Nested player journey cycled on Home");
  });
  await check("TV Volume moves five per press only after OK and releases Back", async () => {
    await click('[data-now-playing] button[aria-label^="Open player:"]');
    await click('.player-page button[aria-label="Volume"]');
    const slider = control('[aria-label="Volume controls"] [role="slider"]');
    slider.focus();
    const before = Number(slider.getAttribute("aria-valuenow"));
    await key("ArrowLeft");
    assert(Number(slider.getAttribute("aria-valuenow")) === before, "Volume changed before OK");
    slider.focus(); await key("Enter");
    await key(before >= 5 ? "ArrowLeft" : "ArrowRight");
    assert(Number(slider.getAttribute("aria-valuenow")) === before + (before >= 5 ? -5 : 5), "Volume did not move five");
    await key("Escape");
    assert(document.querySelector('[data-slot="popover-content"][data-state="open"]') && !slider.hasAttribute("data-adjusting"), "First Back did not end adjustment");
    await key("Escape"); await wait(350);
    assert(!document.querySelector('[data-slot="popover-content"][data-state="open"]') && document.activeElement?.getAttribute("aria-label") === "Volume", "Popover Back did not restore Volume");
    await key("Escape"); await key("Escape");
    assert(location.pathname === "/", "Volume overlay lost Home opener");
  });
  await check("Where it plays opens on its first device, Down walks its devices, Left and Right move a level at once, and Back returns to its button", async () => {
    await click('[data-app-nav] a[href="/"]');
    await click('[data-now-playing] button[aria-label="Where it plays"]');
    const rows = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"] [data-device-row]')];
    await until(() => !!document.activeElement && document.activeElement === rows()[0]);
    assert(rows().length >= 2, "Pair a second online shared output before running");
    await key("ArrowDown");
    assert(document.activeElement === rows()[1], "Down did not reach the next device");
    assert(!document.querySelector('[role="menu"]'), "Down opened a row's options");
    const row = rows().find(item => item.getAttribute("aria-valuetext") !== "No sound");
    if (row) {
      row.focus();
      const level = Number(row.getAttribute("aria-valuenow"));
      const target = level >= 5 ? level - 5 : level + 5;
      await key(level >= 5 ? "ArrowLeft" : "ArrowRight");
      await until(() => Number(row.getAttribute("aria-valuenow")) === target);
      assert(document.activeElement === row, "A level change moved focus");
      await key(level >= 5 ? "ArrowRight" : "ArrowLeft");
    }
    await key("Escape");
    await until(() => !document.querySelector('[role="dialog"][data-state="open"]') && !!document.activeElement?.matches('[data-now-playing] button[aria-label="Where it plays"]'));
  });
  await check("OK opens a row's options with Picture and Sound, without Mute or Move here; Sync… puts focus on its Sync line, and Back hides a line still at 0", async () => {
    await click('[data-now-playing] button[aria-label="Where it plays"]');
    const rows = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"] [data-device-row]')];
    const items = () => [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')];
    const item = (text: string) => items().find(element => element.textContent?.startsWith(text));
    let name = "", added = false;
    const device = () => rows().find(row => row.getAttribute("aria-label") === name)!;
    const sound = () => device()?.getAttribute("aria-valuetext") !== "No sound";
    try {
      await until(() => document.activeElement === rows()[0]);
      assert(rows().length >= 2, "Pair a second online shared output before running");
      // Sync applies while the sound plays in sync on several devices, so the second device's sound joins.
      name = rows()[1]!.getAttribute("aria-label")!;
      device().focus(); await key("Enter");
      await until(() => !!item("Picture") && !!item("Sound"));
      assert(!item("Mute"), "A row's options offer Mute; its Sound and level are its sound, and the Volume mutes");
      assert(!item("Move here"), "A row's options offer Move here");
      if (!sound()) { added = true; item("Sound")!.click(); await until(sound); await wait(1500); }
      else await key("Escape");
      const first = () => rows()[0]!;
      first().focus(); await key("Enter");
      await until(() => !!item("Sound"));
      const sync = item("Sync…") ?? item("Lip sync…");
      assert(sync, "No Sync… while the sound plays on both devices");
      sync!.click();
      const line = () => first().closest("li")!.querySelector<HTMLElement>("[data-sync-line] [role=slider]");
      await until(() => !!line() && document.activeElement === line());
      if (line()!.getAttribute("aria-valuenow") === "0") {
        await key("Escape");
        await until(() => !line() && document.activeElement === first());
      }
    } finally {
      if (added && sound()) { device().focus(); await key("Enter"); await until(() => !!item("Sound")).catch(() => undefined); item("Sound")?.click(); await until(() => !sound()).catch(() => undefined); }
      for (let attempt = 0; attempt < 3 && document.querySelector('[role="dialog"][data-state="open"]'); attempt++) { await key("Escape"); await wait(350); }
    }
  });
  await check("Saved Details keeps Remove, Undo and ordering reachable with one row stop", async () => {
    await click('[data-app-nav] a[href="/saved"]');
    const rows = () => [...document.querySelectorAll<HTMLElement>('[data-saved-details]')];
    assert(rows().length >= 2, "Save two video fixtures before running");
    assert(rows().every(row => [...row.querySelectorAll('button:not(:disabled),a[href]')].filter(element => !element.closest('[inert]')).length === 1), "Saved row has multiple focus stops");
    const id = rows()[0]!.dataset.savedDetails!;
    await click(`[data-saved-details="${id}"] button[aria-label^="Details"]`);
    await until(() => !!document.querySelector('[data-page="Item"] button[aria-label^="Options"]'));
    const options = async () => { control('[data-page="Item"] button[aria-label^="Options"]').focus(); await key("Enter"); await wait(350); };
    const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(element => element.textContent?.trim() === label);
    await options();
    assert(document.querySelector('[role="menu"]'), "Saved Options did not open");
    assert(menuItem("Remove"), "Saved Details has no Remove");
    assert(menuItem("Move down") && !menuItem("Move down")?.hasAttribute("data-disabled"), "Saved Details has no enabled Move down");
    menuItem("Move down")!.click(); await wait(350);
    await key("Escape"); await wait(350);
    assert(location.pathname === "/saved" && rows()[1]?.dataset.savedDetails === id, "Move down did not persist the saved order");
    await click(`[data-saved-details="${id}"] button[aria-label^="Details"]`);
    await options(); menuItem("Move up")!.click(); await wait(350);
    await options(); menuItem("Remove")!.click();
    await until(() => location.pathname === "/saved" && !document.querySelector(`[data-saved-details="${id}"]`));
    const undo = [...document.querySelectorAll<HTMLElement>('[data-sonner-toast] button')].find(element => element.textContent === "Undo");
    assert(undo, "Saved removal did not offer Undo");
    assert(document.activeElement?.closest('[data-page]'), "Saved removal lost page focus");
    const fallback = document.activeElement as HTMLElement;
    assert(!fallback.matches(':disabled, [aria-disabled="true"]') && !fallback.closest('[inert], [aria-hidden="true"]') && fallback.getClientRects().length > 0, "Saved removal fallback is unavailable");
    await wait(350);
    assert(document.activeElement === fallback, "Saved removal fallback did not survive settling");
    await key("ArrowDown");
    const next = document.activeElement;
    assert(next !== fallback && next?.closest('[data-page]'), "Next arrow did not continue from the removal fallback");
    await wait(350);
    assert(document.activeElement === next, "Removal restoration stole deliberate next-key focus");
    undo!.click();
    await until(() => rows()[0]?.dataset.savedDetails === id);
    assert(document.activeElement === next, "Saved Undo stole deliberate focus");
  });
  await check("A remote reaches a removal's Undo by Up past the tabs, Back leaves it, and OK undoes", async () => {
    await click('[data-app-nav] a[href="/saved"]');
    const rows = () => [...document.querySelectorAll<HTMLElement>('[data-saved-details]')];
    const toasts = () => document.querySelectorAll("[data-sonner-toast]").length;
    for (let attempt = 0; attempt < 80 && toasts(); attempt++) await wait(100);
    assert(!toasts() && rows().length >= 2, "Save two video fixtures, and let earlier toasts close, before running");
    const remote = async (key: Parameters<typeof applyTvNavigation>[0]) => { applyTvNavigation(key); await wait(350); };
    const id = rows()[0]!.dataset.savedDetails!;
    await click(`[data-saved-details="${id}"] button[aria-label^="Details"]`);
    await until(() => !!document.querySelector('[data-page="Item"] button[aria-label^="Options"]'));
    control('[data-page="Item"] button[aria-label^="Options"]').focus(); await remote("select");
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(element => element.textContent?.trim() === "Remove")!.focus();
    await remote("select");
    await until(() => location.pathname === "/saved" && !document.querySelector(`[data-saved-details="${id}"]`));
    const undo = () => [...document.querySelectorAll<HTMLElement>("[data-sonner-toast] [data-button]")].find(element => element.textContent === "Undo");
    assert(undo() && !document.activeElement?.closest("[data-sonner-toaster]"), "The removal's Undo is missing or took focus");
    const up = async () => { for (let step = 0; step < 8 && !document.activeElement?.closest("[data-sonner-toaster]"); step++) await remote("up"); };
    await up();
    assert(document.activeElement === undo(), "Up past the tabs did not reach Undo");
    await remote("back");
    const tab = document.activeElement;
    assert(tab?.matches('.app-header [aria-current="page"]') && location.pathname === "/saved", "Back on Undo did not return to the tab");
    await up();
    await remote("select");
    await until(() => rows()[0]?.dataset.savedDetails === id && !undo());
    await wait(350);
    assert(document.activeElement === tab, "Undo did not return focus to the tab it came from");
  });
  await check("Saved favorites retain remote ordering, Remove and Undo", async () => {
    await click('[data-app-nav] a[href="/saved"]');
    await click('a[href="/saved?tab=channels"]');
    const rows = () => [...document.querySelectorAll<HTMLElement>('[aria-label="Channels & stations"] li')];
    const options = (row?: HTMLElement) => row?.querySelector<HTMLElement>('button[aria-label^="Options"]');
    const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(element => element.textContent === label);
    await until(() => rows().length >= 2);
    // The fixture saves two; a Couch with more keeps its count.
    const count = rows().length;
    // A station's page holds no ordering or Remove, so its row's Options menu does.
    const label = options(rows()[0])?.getAttribute("aria-label");
    assert(label, "Favorite lost Options");
    options(rows()[0])!.focus(); await key("Enter");
    const down = menuItem("Move down");
    assert(down && !down.hasAttribute("data-disabled"), "Favorite lost Move down");
    down!.click();
    await until(() => options(rows()[1])?.getAttribute("aria-label") === label);
    options(rows()[1])!.focus(); await key("Enter");
    const remove = menuItem("Remove");
    assert(remove, "Favorite lost Remove");
    remove!.click();
    await until(() => rows().length === count - 1);
    const undo = [...document.querySelectorAll<HTMLElement>('[data-sonner-toast] button')].find(element => element.textContent === "Undo");
    assert(undo && document.activeElement?.closest('[aria-label="Channels & stations"]'), "Favorite removal lost Undo or adjacent focus");
    // Undo saves the station again, then its order, so the list can briefly show the save alone.
    const restored = () => rows().length === count && options(rows()[1])?.getAttribute("aria-label") === label;
    undo!.click(); await until(restored).catch(() => undefined);
    assert(restored(), "Favorite Undo lost saved order");
  });
  await check("Live TV retains Queue and Play on without a Details destination", async () => {
    await click('[data-app-nav] a[href="/"]');
    await until(() => !!document.querySelector('[data-page="Home"] a[href="/live-tv"]'));
    await click('[data-page="Home"] a[href="/live-tv"]');
    await until(() => !!document.querySelector('[aria-label="Live TV channels"] li'));
    const title = control('[aria-label="Live TV channels"] [data-play]').getAttribute("aria-label")!.replace(/^Play /, "");
    control('[aria-label="Live TV channels"] button[aria-label^="Options"]').focus(); await key("Enter");
    const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const targets = [...control('[role="group"][aria-label="Play on"]').querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const target = targets.find(item => !item.textContent?.includes("This device"));
    const targetName = target?.querySelector("span")?.textContent;
    assert(targets.length >= 2 && targetName && !target?.hasAttribute("data-disabled"), "Live TV lost enabled Play on device targets (pair a second online output)");
    const queue = items().find(item => item.textContent === "Queue");
    assert(queue && !queue.hasAttribute("data-disabled"), "Live TV lost enabled Queue");
    const originalFetch = window.fetch;
    let queued = false;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (/\/api\/iptv\/channels\/[^/]+\/queue$/.test(new URL(String(args[0]), location.href).pathname) && response.ok) queued = true;
      return response;
    };
    try { queue!.click(); await until(() => queued); }
    finally { window.fetch = originalFetch; }
    await wait(350);
    assert(location.pathname === "/live-tv", "Queue left Live TV");
    await click('[data-now-playing] button[aria-label="Up next"]');
    await until(() => !!document.querySelector('[data-queue-panel] ul[aria-label="Up next"]'));
    assert(document.querySelector('[data-queue-panel] ul[aria-label="Up next"]')?.textContent?.includes(title), "Live TV Queue did not add the channel");
    await key("Escape"); await key("Escape"); await key("Escape");
    assert(location.pathname === "/live-tv", "Queue Back lost Live TV opener");
    control('[aria-label="Live TV channels"] button[aria-label^="Options"]').focus(); await key("Enter");
    const recipient = [...control('[role="group"][aria-label="Play on"]').querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find(item => item.querySelector("span")?.textContent === targetName);
    assert(recipient && !recipient.hasAttribute("data-disabled"), "Play on target disappeared after Queue");
    recipient!.click();
    // Where it plays opened before Play on lands closes as the bar moves to the recipient's Playback.
    await until(() => !!document.querySelector('[data-now-playing] button[aria-label="Where it plays"]:not(:disabled)') && !!document.querySelector("[data-now-playing]")?.textContent?.includes(`on ${targetName}`));
    await click('[data-now-playing] button[aria-label="Where it plays"]');
    // The recipient's row is the only one playing it, and it shows the picture.
    const playing = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"] ul[aria-label="Playing"] [data-device-row]')];
    await until(() => playing().length === 1 && playing()[0]!.getAttribute("aria-label") === targetName);
    assert(playing()[0]!.querySelector("svg.lucide-monitor"), "Play on did not select the recipient's picture");
    assert(document.querySelector("[data-now-playing]")?.textContent?.includes(title), "Play on did not select the queued channel");
    await key("Escape"); await wait(350);
    assert(location.pathname === "/live-tv", "Play on lost the controller's browse page");
  });
  return results;
};

export {};
