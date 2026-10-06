// Run in an isolated paired TV renderer with paused seekable video, two saved videos,
// two radio favorites, a Live TV fixture and a second online shared output.
// See docs/native-tv.md for the browser regression command and prerequisites.
declare global {
  interface Window { runTvNavigationRegression: () => Promise<{ name: string; passed: boolean; error?: string }[]> }
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
    assert(items.every(item => item.querySelectorAll('button:not(:disabled), a[href]').length === 1), "Radio has multiple stops per item");
    assert(!document.querySelector('.app-header [data-slot="popover-trigger"]'), "TV header still has Couch switch");
  });
  await check("Settings OK enters content; Back restores rail then Home", async () => {
    await click('[data-app-nav] a[href="/settings"]');
    const rail = control('[data-settings-page="connection"]');
    rail.focus(); rail.click(); await wait(350);
    assert(document.activeElement?.closest('[data-settings-content]'), "OK lost content focus");
    assert(document.activeElement?.textContent === "Pair a device", "Devices did not begin on Pair a device");
    (document.activeElement as HTMLElement).click(); await wait(350);
    assert(document.querySelector('[role="dialog"][data-state="open"]'), "Pairing overlay did not open");
    await key("Escape"); await wait(350);
    assert(!document.querySelector('[role="dialog"][data-state="open"]'), "Back did not close pairing overlay");
    assert(location.pathname === "/settings/connection" && document.activeElement?.textContent === "Pair a device", "Overlay Back did not return to its opener");
    await key("Escape");
    assert(document.activeElement?.matches('[data-settings-page="connection"]'), "Back did not restore rail");
    await key("Escape");
    assert(location.pathname === "/", "Rail Back did not reach Home");
  });
  await check("Saved Home tile opens Details, settles page focus and restores its opener", async () => {
    const tile = control('[data-saved-details] button');
    const label = tile.getAttribute("aria-label");
    assert(tile.parentElement?.querySelectorAll('button:not(:disabled),a[href]').length === 1, "Saved media has multiple stops");
    tile.focus(); tile.click();
    await until(() => location.pathname === "/item" && !!document.querySelector('[data-page="Item"] h1'));
    await wait(350);
    assert(document.activeElement?.closest('[data-page="Item"]'), "Loaded Details lost page-entry focus");
    await key("Escape");
    await until(() => location.pathname === "/" && document.activeElement?.getAttribute("aria-label") === label);
    assert(document.activeElement?.closest('[data-saved-details]'), "Details Back lost Home tile focus");
  });
  await check("TV HUD hides, seeks ten seconds and returns to opener without a Home cycle", async () => {
    await click('[data-app-nav] a[href="/find"]');
    await click('[data-mini-player] button[aria-label^="Open player:"]');
    const video = document.querySelector('video')!;
    await until(() => video.readyState >= 2 && video.duration > 20);
    await until(() => !!document.querySelector('.player-page [data-play-button]:not(:disabled)'));
    const pause = document.querySelector<HTMLButtonElement>('.player-page [data-play-button][aria-label="Pause"]');
    if (pause && !pause.disabled) { pause.click(); await until(() => video.paused); }
    assert(video.paused && video.duration > 20, "Pause a seekable video fixture before running");
    assert(document.querySelector('[data-player-paused]'), "No large paused state");
    assert(!document.querySelector('[data-player-header], .player-page button[aria-label="Enter fullscreen"]'), "TV still has desktop chrome");
    await key("Escape");
    assert(control('[data-player-band]').getAttribute('data-player-band') === "hidden", "Back left instead of hiding HUD");
    const before = video.currentTime;
    await key("ArrowRight"); await wait(500);
    assert(video.currentTime >= before + 8 && video.currentTime <= before + 12, "Hidden Right did not seek ten seconds");
    assert(document.activeElement?.getAttribute('aria-label') === "Playback position", "Hidden Right did not focus timeline");
    await key("Escape"); await key("Escape");
    assert(location.pathname === "/find", "Player did not return to its opener");
    await key("Escape"); await key("Escape"); await key("Escape");
    assert(location.pathname === "/", "Back on Home reopened player");
  });
  await check("Up next and Details preserve the player's opener and focus", async () => {
    await click('[data-app-nav] a[href="/find"]');
    await click('[data-mini-player] button[aria-label^="Open player:"]');
    await click('.player-page button[aria-label="Up next"]');
    assert(location.search.includes("queue=true"), "Queue URL did not open");
    await key("Escape");
    assert(!location.search.includes("queue=true") && document.activeElement?.getAttribute("aria-label") === "Up next", "Queue Back lost trigger focus");
    await click('.player-page button[aria-label="Playback"]');
    const entryHref = control('[data-player-sheet] a[href^="/item"]').getAttribute("href");
    await click('[data-player-sheet] a[href^="/item"]');
    assert(location.pathname === "/item", "Details did not open");
    assert(document.activeElement?.closest('[data-page="Item"]'), "Details lost page-entry focus");
    await key("Escape");
    assert(location.pathname === "/now", "Details Back skipped player");
    await wait(350);
    assert(document.activeElement?.getAttribute("aria-label") === "Playback", "Details Back lost Playback opener focus");
    assert(document.querySelector('video')?.paused && document.querySelector('.player-page [data-play-button][aria-label="Play"]'), "Details Back changed paused playback");
    (document.activeElement as HTMLElement).click(); await wait(350);
    assert(document.querySelector('[data-player-sheet]') && document.querySelector('video')?.paused, "Immediate OK resumed instead of opening Playback");
    assert(control('[data-player-sheet] a[href^="/item"]').getAttribute("href") === entryHref, "Details Back changed the played entry");
    await key("Escape"); await wait(350);
    assert(document.activeElement?.getAttribute("aria-label") === "Playback", "Playback Back lost opener focus");
    await key("Escape"); await key("Escape");
    assert(location.pathname === "/find", "Queue URL or Details lost original opener");
    await key("Escape"); await key("Escape");
    assert(location.pathname === "/", "Nested player journey cycled on Home");
  });
  await check("TV Volume moves five per press only after OK and releases Back", async () => {
    await click('[data-mini-player] button[aria-label^="Open player:"]');
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
    undo!.click();
    await until(() => rows()[0]?.dataset.savedDetails === id);
  });
  await check("Saved favorites retain remote ordering, Remove and Undo", async () => {
    await click('[data-app-nav] a[href="/saved"]');
    await click('a[href="/saved?tab=channels"]');
    const rows = () => [...document.querySelectorAll<HTMLElement>('[aria-label="Channels & stations"] li')];
    await until(() => rows().length >= 2);
    const first = rows()[0]!;
    const reorder = first.querySelector<HTMLElement>('button[aria-label^="Reorder"]');
    assert(reorder, "Favorite lost Reorder");
    const label = reorder!.getAttribute("aria-label");
    reorder!.focus(); await key("Enter"); await key("ArrowDown"); await key("Enter");
    await until(() => rows()[1]?.querySelector('button[aria-label^="Reorder"]')?.getAttribute("aria-label") === label);
    const options = rows()[1]!.querySelector<HTMLElement>('button[aria-label^="Options"]');
    assert(options, "Favorite lost Options");
    options!.focus(); await key("Enter");
    const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(element => element.textContent === "Remove");
    assert(remove, "Favorite lost Remove");
    remove!.click();
    await until(() => rows().length === 1);
    const undo = [...document.querySelectorAll<HTMLElement>('[data-sonner-toast] button')].find(element => element.textContent === "Undo");
    assert(undo && document.activeElement?.closest('[aria-label="Channels & stations"]'), "Favorite removal lost Undo or adjacent focus");
    undo!.click(); await until(() => rows().length === 2);
    assert(rows()[1]?.querySelector('button[aria-label^="Reorder"]')?.getAttribute("aria-label") === label, "Favorite Undo lost saved order");
  });
  await check("Live TV retains Queue and Play on without a Details destination", async () => {
    await click('[data-app-nav] a[href="/find"]');
    await click('button[aria-label="Open Live TV"]');
    await until(() => !!document.querySelector('[aria-label="Live TV channels"] li'));
    const title = control('[aria-label="Live TV channels"] [data-play]').getAttribute("aria-label")!.replace(/^Play /, "");
    control('[aria-label="Live TV channels"] button[aria-label^="Options"]').focus(); await key("Enter");
    const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    assert(items().some(item => item.textContent === "Play on"), "Live TV lost Play on (pair a second online output)");
    const queue = items().find(item => item.textContent === "Queue");
    assert(queue && !queue.hasAttribute("data-disabled"), "Live TV lost enabled Queue");
    queue!.click(); await wait(350);
    assert(location.search.includes("live-tv"), "Queue left Live TV");
    await click('[data-mini-player] button[aria-label="Up next"]');
    await until(() => !!document.querySelector('[data-queue-panel] ul[aria-label="Up next"]'));
    assert(document.querySelector('[data-queue-panel] ul[aria-label="Up next"]')?.textContent?.includes(title), "Live TV Queue did not add the channel");
    await key("Escape"); await key("Escape"); await key("Escape");
    assert(location.search.includes("live-tv"), "Queue Back lost Live TV opener");
  });
  return results;
};

export {};
