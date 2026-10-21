// Run in an empty Vite fixture at ?tv=1. Production routes and remote dispatch;
// deterministic reads, with no playback or API writes leaving the fixture.
// Click the empty fixture with the real pointer before running to test remote focus
// independently of the browser's trusted-keyboard :focus-visible heuristic.
import { mountUiAudit } from "./ui-audit.browser";
import { applyTvNavigation } from "../src/client/navigation";

const wait = (ms = 350) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const control = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
};
const remote = async (key: Parameters<typeof applyTvNavigation>[0]) => { applyTvNavigation(key); await wait(); };

export async function runTvFocusRegression() {
  const audit = await mountUiAudit();
  const results: { name: string; passed: boolean; error?: string }[] = [];
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: String(error) }); }
  };
  try {
    await check("Remote focus is visible after pointer input", async () => {
      await audit.go('/');
      const home = control('.app-header a[href="/"]');
      home.focus(); await remote('right');
      const style = getComputedStyle(document.activeElement!);
      assert(style.backgroundColor === 'rgb(255, 255, 255)' && style.color === 'rgb(0, 0, 0)', "Remote focus has no visible inversion");
    });
    await check("Horizontal boundaries do not jump to unrelated rows", async () => {
      await audit.go('/');
      const home = control('.app-header a[href="/"]');
      home.focus(); await remote('left');
      assert(document.activeElement === home, "Left from Home jumped into the page");
      const links = [...document.querySelectorAll<HTMLElement>('[aria-label="For later"] [data-media-context] a')];
      assert(links.length >= 2, "Missing relationship fixture");
      links.at(-1)!.focus(); await remote('right');
      assert(document.activeElement === links.at(-1), "Right from the last relationship jumped up to its tile");
      await remote('left');
      assert(document.activeElement === links[0], "Left did not reach the adjacent relationship");
    });
    await check("Back restores the exact relationship link, including repeated destinations", async () => {
      for (const selector of ['[data-home-hero] [data-media-context] a', '[aria-label="For later"] [data-media-context] a']) {
        await audit.go('/');
        const link = control(selector);
        const href = link.getAttribute('href');
        link.focus(); await remote('select');
        assert(audit.router.state.location.pathname === '/collection', "Relationship did not open its collection");
        await remote('back');
        assert(audit.router.state.location.pathname === '/', "Back did not return to Home");
        assert(document.activeElement === control(selector) && document.activeElement?.getAttribute('href') === href, "Back lost the exact relationship opener");
      }
    });
    await check("The TV BrowserBack key closes a picker without leaving its page", async () => {
      await audit.go('/discover/live-tv');
      const source = control('button[aria-label="Group"]');
      source.focus(); await remote('select');
      assert(document.querySelector('[role="listbox"]'), "Group did not open");
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'BrowserBack', bubbles: true, cancelable: true }));
      await wait();
      assert(!document.querySelector('[role="listbox"]') && document.activeElement === source, "BrowserBack trapped focus in the picker");
      assert(audit.router.state.location.pathname === '/discover/live-tv', "Closing the picker also left its page");
    });
    await check("Saved rails enter content and return to the selected section", async () => {
      for (const tab of ['later', 'channels', 'lists', 'played']) {
        await audit.go(tab === 'later' ? '/saved' : `/saved?tab=${tab}`);
        const rail = control('[data-nav-rail] [aria-current="page"]');
        assert(document.activeElement === rail, "Saved entry missed its current section");
        await remote('right');
        assert(document.activeElement?.closest('[data-nav-content]'), `${tab}: Right stayed in the rail`);
        await remote('left');
        assert(document.activeElement === rail, `${tab}: Left lost the selected section`);
      }
    });
    await check("Settings OK, dialog Back, content Back and Home preserve focus", async () => {
      await audit.go('/settings/couch/devices');
      const rail = control('[data-settings-page="devices"]');
      rail.focus(); await remote('select');
      const pair = document.activeElement;
      assert(pair?.textContent === 'Pair a device', "Settings OK did not enter its first action");
      await remote('select');
      assert(document.activeElement?.closest('[role="dialog"]'), "Pairing dialog did not take focus");
      await remote('back');
      assert(document.activeElement === pair, "Dialog Back lost Pair a device");
      await remote('back');
      assert(document.activeElement === rail, "Content Back lost the current Settings section");
      await remote('back');
      assert(audit.router.state.location.pathname === '/', "Settings Back did not reach Home");
    });
    await check("Settings vertical movement visits recovery actions before the next section", async () => {
      await audit.go('/settings/couch/devices');
      control('[aria-label="Share on network"]').focus();
      await remote('down');
      assert(document.activeElement?.textContent === 'Try again', "Down skipped the first relay recovery action");
      await remote('down');
      assert(document.activeElement?.textContent === 'External relay settings', "Down skipped the next settings section");
      await remote('down');
      assert(document.activeElement?.textContent === 'Try again', "Down left content before its second recovery action");
    });
    await check("Player panels and nested queue menus restore their own openers", async () => {
      await audit.go('/now', { player: 'paused', video: true });
      for (const label of ['Volume', 'Playback', 'Up next']) {
        const trigger = control(`button[aria-label="${label}"]`);
        trigger.focus(); await remote('select');
        assert(trigger.getAttribute('aria-expanded') === 'true' && document.activeElement !== trigger, `${label} did not take focus`);
        if (label === 'Up next') {
          const options = control('[data-player-queue] button[aria-label="Options for The next concert"]');
          options.focus(); await remote('select');
          assert(document.activeElement?.closest('[role="menu"]'), "Queue menu did not take focus");
          await remote('back');
          assert(document.activeElement === options, "Queue menu Back lost its opener");
        }
        await remote('back');
        assert(document.activeElement === trigger && trigger.getAttribute('aria-expanded') === 'false', `${label} Back lost its opener`);
      }
      await remote('back');
      assert(document.activeElement?.matches('[data-player-surface]'), "Player Back did not return to the picture");
      await remote('select');
      assert(document.activeElement?.matches('[data-play-button]'), "First OK did not reveal transport");
      // This renderer has no decoded video: its timeline is correctly disabled.
      await remote('back');
      await remote('up');
      assert(document.activeElement?.matches('[data-play-button]'), "Up without a seekable timeline did not reveal transport");
    });
    await check("Remote transport focus keeps playing-video controls visible", async () => {
      await audit.go('/now', { player: 'playing', video: true });
      control('[data-player-surface]').focus();
      await remote('select');
      assert(document.activeElement?.matches('[data-play-button]'), "Remote OK did not focus transport");
      await wait(4500);
      assert(document.querySelector('[data-player-band="shown"]') && document.activeElement?.matches('[data-play-button]'), "Idle timeout hid a remote-focused control");
    });
    await check("Held-item menu Back returns to the tile without acting", async () => {
      await audit.go('/');
      const tile = control('[aria-label="Radio stations"] [data-item-menu]');
      tile.focus(); await remote('menu');
      assert(document.activeElement?.closest('[role="menu"]'), "Item menu did not take focus");
      await remote('back');
      assert(document.activeElement === tile, "Item menu Back lost its tile");
    });
    await check("Late content yields to deliberate remote navigation", async () => {
      const originalFetch = window.fetch;
      let release = () => {};
      const gate = new Promise<void>(resolve => { release = resolve; });
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (String(args[0]).includes('/api/providers/')) await gate;
        return response;
      };
      try {
        await audit.go('/discover', { fresh: true });
        await remote('up');
        const deliberate = document.activeElement;
        release(); await wait(700);
        assert(document.activeElement === deliberate, "Late catalogue stole deliberate focus");
      } finally { release(); window.fetch = originalFetch; }
    });
    await check("Search's kinds and sources take the arrows and OK, and keep the focus", async () => {
      await audit.go('/search?q=concert', { fresh: true });
      (document.activeElement as HTMLElement | null)?.blur(); await remote('down');
      assert(document.activeElement?.matches('[data-search-top] [data-page-first]'), "Search did not start on its top result");
      const all = control('[role="radiogroup"][aria-label="Kind"] [aria-checked="true"]');
      // Up passes the top result's own links on its way.
      for (let step = 0; step < 6 && document.activeElement !== all && !document.activeElement?.closest('.app-header'); step++) await remote('up');
      assert(document.activeElement === all && all.firstChild?.textContent === "All", "Up from the top result missed the kinds");
      await remote('right'); await remote('select');
      const films = document.activeElement as HTMLElement;
      assert(films.firstChild?.textContent === "Films & series" && films.getAttribute("aria-checked") === "true" && audit.router.state.location.searchStr.includes("kind=films"), "OK did not choose the focused kind, or lost the focus");
      await remote('down');
      const source = document.activeElement as HTMLElement;
      assert(source.closest('[aria-label="Source"]'), "Down from a kind missed its sources");
      await remote('select');
      assert(document.activeElement === source && source.getAttribute("aria-pressed") === "true" && audit.router.state.location.searchStr.includes("source="), "OK did not press the focused source, or lost the focus");
    });
  } finally { audit.close(); }
  return results;
}

/** Check each directional edge and that every available action can be reached from entry. */
export async function runTvFocusReachability() {
  const audit = await mountUiAudit();
  const { settingsPages } = await import('../src/shared/settings-pages');
  const browse = ['/', '/discover', '/search?q=concert', '/discover/radio', '/discover/live-tv', '/saved', '/saved?tab=channels', '/saved?tab=lists', '/saved?tab=played', '/collection?provider=youtube&url=https%3A%2F%2Fwww.youtube.com%2F%40nprmusic', '/item?kind=saved&id=concert'];
  const cases = [
    ...[...browse, ...Object.values(settingsPages).map(page => page.path), '/remote', '/where-it-plays'].map(href => ({ href, mode: 'loaded' as const })),
    ...(['loading', 'empty', 'error'] as const).flatMap(mode => browse.map(href => ({ href, mode }))),
  ];
  const results: { href: string; mode: string; controls: number; unreachable: string[]; obscured: string[] }[] = [];
  const label = (element: Element) => element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName;
  try {
    for (const { href, mode } of cases) {
      await audit.go(href, { mode, fresh: true });
      const controls = [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]')]
        .filter(element => (element.tabIndex >= 0 || element.matches('[role="radio"], [role="tab"]')) && !element.matches('[role="radiogroup"], [role="tablist"]') && element.checkVisibility() && !element.matches(':disabled, [aria-disabled="true"]') && !element.closest('[inert], [aria-hidden="true"], [data-tv-local-only]'));
      let start = controls.indexOf(document.activeElement as HTMLElement);
      if (start < 0) { applyTvNavigation('down'); start = controls.indexOf(document.activeElement as HTMLElement); }
      const obscured = new Set<string>();
      const edges: number[][] = [];
      for (const element of controls) {
        const destinations: number[] = [];
        for (const key of ['up', 'down', 'left', 'right'] as const) {
          element.focus(); applyTvNavigation(key);
          // Radix roving groups move to the next option on a queued task.
          await wait(0);
          const active = document.activeElement as HTMLElement;
          if (active !== element) {
            const rect = active.getBoundingClientRect();
            const x = Math.max(0, Math.min(innerWidth - 1, rect.x + rect.width / 2));
            const y = Math.max(0, Math.min(innerHeight - 1, rect.y + rect.height / 2));
            const hit = document.elementFromPoint(x, y);
            if (!active.contains(hit) && !hit?.contains(active)) obscured.add(label(active));
          }
          destinations.push(controls.indexOf(active));
        }
        edges.push(destinations);
      }
      const reached = new Set([start]), pending = [start];
      while (pending.length) for (const index of edges[pending.pop()!] ?? []) {
        if (index >= 0 && !reached.has(index)) { reached.add(index); pending.push(index); }
      }
      results.push({ href, mode, controls: controls.length, unreachable: controls.filter((_, index) => !reached.has(index)).map(label), obscured: [...obscured] });
    }
  } finally { audit.close(); }
  return results;
}
