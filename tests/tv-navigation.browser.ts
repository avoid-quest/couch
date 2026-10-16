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
  await click('[data-app-nav] a[href="/library"]');
  assert(document.activeElement?.matches('nav[aria-label="Library sections"] [aria-current="page"]'), "Direct Library entry lost the rail");
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
    await until(() => location.pathname === "/library");
    await wait(350); // Catch a later mount frame overwriting a briefly correct restoration.
    const restored = document.activeElement as HTMLElement;
    assert(restored?.getAttribute("aria-label") === label && !restored.matches(':disabled, [aria-disabled="true"]')
      && !restored.closest('[inert], [aria-hidden="true"]') && restored.getClientRects().length > 0, "Saved Back did not retain its enabled visible item opener after settling");
    await key("ArrowUp");
    assert(document.activeElement?.getAttribute("aria-label") === previousLabel, "Next arrow did not continue from the restored Saved item");
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
  await click('[data-settings-page="sharing"]');
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
    assert(items.every(item => item.querySelectorAll('button:not(:disabled), a[href]').length === 1), "Radio has multiple stops per item");
    assert(!document.querySelector('.app-header [data-slot="popover-trigger"]'), "TV header still has Couch switch");
  });
  await check("The tab bar scrolls with the page, Up from its first row reaches the current tab, and Back goes Home", async () => {
    await click('[data-app-nav] a[href="/live"]');
    assert(getComputedStyle(control(".app-header")).position !== "sticky", "TV tab bar is still sticky");
    assert(document.activeElement?.closest('[data-page="Live"]'), "Live entry did not start on its first control");
    await key("ArrowUp");
    assert(document.activeElement?.matches('.app-header a[aria-current="page"][href="/live"]'), "Up from the first row did not reach the current tab");
    await key("ArrowDown");
    assert(document.activeElement?.closest('[data-page="Live"]'), "Down from the tab bar did not return to the page");
    await key("Escape"); await wait(350);
    assert(location.pathname === "/", "Back did not take Live to Home");
    await key("Escape"); await wait(350);
    assert(location.pathname === "/", "Back on Home went somewhere");
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
    await click('[data-app-nav] a[href="/search"]');
    await click('[data-now-playing] button[aria-label^="Open player:"]');
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
    assert(location.pathname === "/search", "Player did not return to its opener");
    await key("Escape"); await key("Escape"); await key("Escape");
    assert(location.pathname === "/", "Back on Home reopened player");
  });
  await check("Up next and Details preserve the player's opener and focus", async () => {
    await click('[data-app-nav] a[href="/search"]');
    await click('[data-now-playing] button[aria-label^="Open player:"]');
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
    assert(location.pathname === "/search", "Queue URL or Details lost original opener");
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
  await check("Saved Details keeps Remove, Undo and ordering reachable with one row stop", async () => {
    await click('[data-app-nav] a[href="/library"]');
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
    assert(location.pathname === "/library" && rows()[1]?.dataset.savedDetails === id, "Move down did not persist the saved order");
    await click(`[data-saved-details="${id}"] button[aria-label^="Details"]`);
    await options(); menuItem("Move up")!.click(); await wait(350);
    await options(); menuItem("Remove")!.click();
    await until(() => location.pathname === "/library" && !document.querySelector(`[data-saved-details="${id}"]`));
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
  await check("Saved favorites retain remote ordering, Remove and Undo", async () => {
    await click('[data-app-nav] a[href="/library"]');
    await click('a[href="/library?tab=channels"]');
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
    await click('[data-app-nav] a[href="/live"]');
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
    assert(location.pathname === "/live", "Queue left Live TV");
    await click('[data-now-playing] button[aria-label="Up next"]');
    await until(() => !!document.querySelector('[data-queue-panel] ul[aria-label="Up next"]'));
    assert(document.querySelector('[data-queue-panel] ul[aria-label="Up next"]')?.textContent?.includes(title), "Live TV Queue did not add the channel");
    await key("Escape"); await key("Escape"); await key("Escape");
    assert(location.pathname === "/live", "Queue Back lost Live TV opener");
    control('[aria-label="Live TV channels"] button[aria-label^="Options"]').focus(); await key("Enter");
    const recipient = [...control('[role="group"][aria-label="Play on"]').querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find(item => item.querySelector("span")?.textContent === targetName);
    assert(recipient && !recipient.hasAttribute("data-disabled"), "Play on target disappeared after Queue");
    recipient!.click();
    await until(() => !!document.querySelector('[data-now-playing] button[aria-label="Where it plays"]:not(:disabled)'));
    await click('[data-now-playing] button[aria-label="Where it plays"]');
    await until(() => document.querySelector(`[aria-label="Only on ${CSS.escape(targetName!)}"]`)?.getAttribute("aria-pressed") === "true");
    assert(control(`[aria-label="${CSS.escape(targetName!)} picture"]`).getAttribute("aria-pressed") === "true", "Play on did not select the recipient's picture");
    assert(document.querySelector('[role="dialog"]')?.textContent?.includes(title), "Play on did not select the queued channel");
    await key("Escape"); await wait(350);
    assert(location.pathname === "/live", "Play on lost the controller's browse page");
  });
  return results;
};

export {};
