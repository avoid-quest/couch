// Run runHomeFocusRegression() in an empty Vite fixture, both with ?tv=1 and ?tv=0.
// Real routes, Home/bar handlers and focus restoration; deterministic reads and session-state echoes, no Core writes.
import { mountUiAudit } from "./ui-audit.browser";

const wait = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const control = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
};
const visibleControl = (selector: string) => {
  const element = [...document.querySelectorAll<HTMLElement>(selector)].find(element => element.checkVisibility());
  if (!element) throw new Error(`Missing visible ${selector}`);
  return element;
};
const activate = (element: HTMLElement, input: "keyboard" | "pointer") => {
  element.focus();
  // A direct .click() alone leaves provisional TV page-entry restoration
  // active, masking a missing handoff. Real input stops that observer.
  element.dispatchEvent(input === "keyboard"
    ? new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    : new PointerEvent("pointerdown", { pointerType: "mouse", bubbles: true }));
  element.click();
};
const stopFromBar = (input: "keyboard" | "pointer") => {
  const stop = control('[data-now-playing] button[aria-label="Stop"]');
  if (stop.checkVisibility()) activate(stop, input);
  else {
    // Phones stop through the player/OS. Model its state echo with focus on
    // the visible minimized title, not a hidden desktop Stop button.
    const title = visibleControl('[data-now-playing] [data-bar-title] button');
    title.focus();
    title.dispatchEvent(input === "keyboard"
      ? new KeyboardEvent("keydown", { key: "Shift", bubbles: true })
      : new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
  }
};

export async function runHomeFocusRegression() {
  const results: { name: string; passed: boolean; error?: string }[] = [];
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: String(error) }); }
  };
  // The Stage mounts after the persistent bar during Back. Its link is the first
  // occurrence once mounted, but the bar is the only occurrence before then.
  for (const scope of ["[data-home-hero]", "[data-now-playing]"]) {
    await check(`Back restores the ${scope} relationship, not its identical destination elsewhere`, async () => {
      const audit = await mountUiAudit();
      try {
        await audit.go("/", { player: "paused" });
        const selector = `${scope} [data-media-context] a`;
        const link = control(selector), href = link.getAttribute("href");
        assert([...document.querySelectorAll("[data-media-context] a")].filter(a => a.getAttribute("href") === href).length === 2, "Fixture needs identical Stage and bar destinations");
        link.focus(); link.click(); await wait();
        assert(audit.router.state.location.pathname === "/collection", "Relationship did not open its collection");
        audit.router.history.back(); await wait(600);
        assert(audit.router.state.location.pathname === "/", "Back did not return Home");
        assert(document.activeElement === control(selector), "Back restored the wrong occurrence of the relationship");
      } finally { audit.close(); }
    });
  }
  for (const input of ["keyboard", "pointer"] as const) for (const move of [false, true]) {
    await check(`${input} radio Play ${move ? "keeps deliberate focus" : "hands focus to the playing title"}`, async () => {
      const audit = await mountUiAudit();
      const fixtureFetch = window.fetch;
      // No unfinished history: the first station on air leads Home.
      window.fetch = (input, init) => new URL(String(input), location.href).pathname === "/api/progress/history"
        ? Promise.resolve(Response.json({ items: [] })) : fixtureFetch(input, init);
      try {
        await audit.go("/", { fresh: true });
        const play = control('[data-home-hero] [data-page-first]');
        assert(play.getAttribute("aria-label") === "Play NTS Radio", "Fixture needs the radio hero");
        activate(play, input);
        const deliberate = visibleControl('.app-header a[href="/saved"], .app-footer a[href="/saved"]');
        if (move) { deliberate.focus(); assert(document.activeElement === deliberate, "The deliberate control must receive focus before Play completes"); }
        await audit.go("/", { player: "playing", live: true });
        assert(audit.router.state.location.pathname === "/", "Audio Play unexpectedly left Home");
        assert(document.activeElement === (move ? deliberate : control('[data-home-hero] [data-page-first]')),
          move ? "Playing radio stole deliberate focus" : "Playing radio removed Play without handing over its focus");
      } finally { window.fetch = fixtureFetch; audit.close(); }
    });
    await check(`${input} bar Stop ${move ? "keeps deliberate focus" : "returns lost focus to Home"}`, async () => {
      const audit = await mountUiAudit();
      try {
        await audit.go("/", { player: "paused" });
        stopFromBar(input);
        const deliberate = visibleControl('.app-header a[href="/saved"], .app-footer a[href="/saved"]');
        // The state echo arrives after the user has had time to move elsewhere.
        await wait();
        if (move) { deliberate.focus(); assert(document.activeElement === deliberate, "The deliberate control must receive focus before Stop completes"); }
        await audit.go("/");
        assert(!document.querySelector('[data-now-playing]'), "Stop echo did not remove the bar");
        assert(document.activeElement === (move ? deliberate : control('[data-home-hero] [data-page-first]')),
          move ? "Stopping stole deliberate focus" : `Stop removed the bar without returning focus: ${document.activeElement?.tagName}`);
      } finally { audit.close(); }
    });
  }
  await check("Stop from another device hands the playing title's lost focus to the hero", async () => {
    const audit = await mountUiAudit();
    try {
      await audit.go("/", { player: "paused" });
      control('[data-home-hero] [data-page-first]').focus();
      await audit.go("/"); await wait();
      assert(document.activeElement === control('[data-home-hero] [data-page-first]'), `Stop lost the Stage's focus: ${document.activeElement?.tagName}`);
    } finally { audit.close(); }
  });
  await check("Opening the player from the bar keeps destination focus", async () => {
    const audit = await mountUiAudit();
    try {
      await audit.go("/", { player: "paused" });
      activate(control('[data-now-playing] button[aria-label="Open player"]'), "keyboard");
      await wait(600);
      assert(audit.router.state.location.pathname === "/now", "Bar did not open the player");
      assert(document.activeElement?.closest('.player-page'), "Removing the bar lost the player's destination focus");
    } finally { audit.close(); }
  });
  await check("Stop echo after navigation keeps destination focus", async () => {
    const audit = await mountUiAudit();
    try {
      await audit.go("/", { player: "paused" });
      stopFromBar("keyboard");
      await audit.router.navigate({ href: "/saved" }); await wait();
      const deliberate = visibleControl('[data-nav-rail] [aria-current="page"], .app-footer a[aria-current="page"]');
      deliberate.focus();
      assert(document.activeElement === deliberate, "The destination control must receive focus before Stop completes");
      await audit.go("/saved");
      assert(!document.querySelector('[data-now-playing]'), "Stop echo did not remove the bar");
      assert(document.activeElement === deliberate, "Stopping after navigation stole destination focus");
    } finally { audit.close(); }
  });
  return results;
}
