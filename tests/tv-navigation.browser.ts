// Run in an isolated paired TV renderer with a seekable video loaded and saved for later.
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
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  await wait();
};
const click = async (selector: string) => { control(selector).click(); await wait(350); };
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
    await click('[data-player-sheet] a[href^="/item"]');
    assert(location.pathname === "/item", "Details did not open");
    assert(document.activeElement?.closest('[data-page="Item"]'), "Details lost page-entry focus");
    await key("Escape");
    assert(location.pathname === "/now", "Details Back skipped player");
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
  return results;
};

export {};
