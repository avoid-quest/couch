// Empty Vite fixture, ?tv=0 and ?tv=1; production routes and real Radix portals.
// Session Stop echoes model OS/remote Stop without navigation or API writes.
import { mountUiAudit } from "./ui-audit.browser";
import { isTvPresentation } from "../src/client/session/presentation";

const wait = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const control = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
};
const outside = () => {
  const element = [...document.querySelectorAll<HTMLElement>('.app-header a[href="/saved"], .app-footer a[href="/saved"]')].find(element => element.checkVisibility());
  if (!element) throw new Error("Missing a visible Saved tab for the deliberate focus choice");
  return element;
};
const input = (element: HTMLElement, kind: "key" | "pointer" = "key") => {
  element.focus();
  element.dispatchEvent(kind === "key"
    ? new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    : new PointerEvent("pointerdown", { pointerType: "mouse", bubbles: true }));
  element.click();
};
const stopFromBar = () => {
  const stop = control('[data-now-playing] button[aria-label="Stop"]');
  if (stop.checkVisibility()) input(stop);
  else {
    // Phones expose Stop through the player/OS, while the minimized title remains focusable.
    const title = control('[data-now-playing] [data-bar-title] button');
    title.focus();
    title.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
  }
};
// Delay real query responses until the journey explicitly releases them.
function holdReads(paths: string[], emptyHistory = false) {
  const original = window.fetch;
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  window.fetch = async (request, init) => {
    const path = new URL(String(request), location.href).pathname;
    if (emptyHistory && path === "/api/progress/history") return Response.json({ items: [] });
    const response = await original(request, init);
    if (paths.includes(path)) await held;
    return response;
  };
  return { release, close() { release(); window.fetch = original; } };
}

export async function runFocusRecoveryRegression({ includeTimeout = false } = {}) {
  const results: { name: string; passed: boolean; error?: string }[] = [];
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: String(error) }); }
  };
  const panels = matchMedia("(min-width: 640px)").matches ? ["Volume", "Where it plays", "Playback"] : [];
  for (const panel of panels) {
    await check(`External Stop recovers focus from the bar's ${panel} portal`, async () => {
      const audit = await mountUiAudit();
      try {
        await audit.go("/", { player: "paused" });
        input(control(`[data-now-playing] button[aria-label="${panel}"]`));
        await wait();
        assert(document.activeElement?.closest('[role="dialog"]') && !document.activeElement.closest('[data-now-playing]'), "Focus must be inside a real portal outside the footer");
        await audit.stopPlayback(); await wait();
        assert(!document.querySelector('[data-now-playing]'), "Stop must remove the bar");
        assert(document.activeElement === control('[data-home-hero] [data-page-first]'), `External Stop left focus on ${document.activeElement?.tagName}`);
      } finally { audit.close(); }
    });
    await check(`External Stop preserves a choice outside the bar's ${panel} portal`, async () => {
      const audit = await mountUiAudit();
      try {
        await audit.go("/", { player: "paused" });
        input(control(`[data-now-playing] button[aria-label="${panel}"]`)); await wait();
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await wait();
        const chosen = outside();
        chosen.focus();
        await audit.stopPlayback(); await wait();
        assert(document.activeElement === chosen, "External Stop stole deliberately chosen focus");
      } finally { audit.close(); }
    });
  }
  // TV rows always offer a nested menu; desktop offers one only for synchronized outputs.
  if (panels.length && isTvPresentation()) await check("External Stop recovers focus from a nested Where it plays menu portal", async () => {
    const audit = await mountUiAudit();
    try {
      await audit.go("/", { player: "paused" });
      input(control('[data-now-playing] button[aria-label="Where it plays"]')); await wait();
      const options = document.querySelector<HTMLElement>('[role="dialog"] button[aria-haspopup="menu"]')
        ?? control('[role="dialog"] [data-device-row]');
      input(options); await wait();
      assert(document.activeElement?.closest('[role="menu"]') && !document.activeElement.closest('[data-now-playing]'), "Nested menu must take focus in its own portal");
      await audit.stopPlayback(); await wait();
      assert(document.activeElement === control('[data-home-hero] [data-page-first]'), "Nested portal lost focus after Stop");
    } finally { audit.close(); }
  });
  await check("External Stop recovers the minimized title and preserves focus chosen outside it", async () => {
    const audit = await mountUiAudit();
    try {
      await audit.go("/", { player: "paused" });
      control('[data-now-playing] [data-bar-title] button').focus();
      // Cancel provisional TV page entry just as real input on the bar does.
      document.activeElement?.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
      await audit.stopPlayback();
      assert(document.activeElement === control('[data-home-hero] [data-page-first]'), "Title focus was lost after external Stop");
      await audit.go("/", { player: "paused" });
      const chosen = outside();
      chosen.focus();
      await audit.stopPlayback();
      assert(document.activeElement === chosen, "External Stop stole focus outside the bar");
    } finally { audit.close(); }
  });
  await check("The registered OS Media Session Stop callback recovers lost bar focus", async () => {
    const session = navigator.mediaSession;
    const original = session.setActionHandler;
    let stop: MediaSessionActionHandler | null = null;
    session.setActionHandler = function(action, handler) {
      if (action === "stop") stop = handler;
      original.call(this, action, handler);
    };
    const audit = await mountUiAudit();
    try {
      await audit.go("/", { player: "paused" });
      if (panels.length) { input(control('[data-now-playing] button[aria-label="Volume"]')); await wait(); }
      else control('[data-now-playing] [data-bar-title] button').focus();
      const fire = stop as MediaSessionActionHandler | null;
      if (!fire) throw new Error("The application did not register OS Stop");
      fire({ action: "stop" });
      assert(audit.actions.at(-1)?.type === "stop", "OS Stop must send the real transport command");
      await audit.stopPlayback(); await wait();
      assert(document.activeElement === control('[data-home-hero] [data-page-first]'), "OS Stop lost focus after its state echo");
    } finally { audit.close(); session.setActionHandler = original; }
  });
  for (const source of ["history", "radio"]) for (const from of panels.length ? ["bar", "Volume"] : ["bar"]) {
    await check(`Stop from ${from} hands provisional focus to the delayed ${source} hero`, async () => {
      const audit = await mountUiAudit();
      const held = holdReads([source === "history" ? "/api/progress/history" : "/api/radio/programmes"], source === "radio");
      try {
        await audit.go("/", { player: "paused", fresh: true });
        if (from === "bar") stopFromBar();
        else { input(control('[data-now-playing] button[aria-label="Volume"]')); await wait(); }
        await audit.stopPlayback();
        assert(!document.querySelector('[data-home-hero] [data-page-first]') && document.querySelector('[data-loading]'), "Stop must reveal the pending Home skeleton");
        held.release(); await wait(700);
        assert(document.activeElement === control('[data-home-hero] [data-page-first]'), `Delayed ${source} hero never received focus: ${document.activeElement?.tagName}`);
      } finally { held.close(); audit.close(); }
    });
  }
  for (const choice of ["key", "pointer", "focus", "route"] as const) {
    await check(`Delayed Stop recovery cancels on deliberate ${choice}`, async () => {
      const audit = await mountUiAudit();
      const held = holdReads(["/api/progress/history"]);
      try {
        await audit.go("/", { player: "paused", fresh: true });
        stopFromBar();
        await audit.stopPlayback();
        if (choice === "route") await audit.router.navigate({ href: "/saved" });
        else if (choice === "focus") {
          const chosen = outside();
          chosen.focus(); chosen.blur(); // Even a later loss of that choice must not re-arm recovery.
        } else document.activeElement?.dispatchEvent(choice === "key"
          ? new KeyboardEvent("keydown", { key: "Shift", bubbles: true })
          : new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
        await wait();
        const chosen = document.activeElement;
        held.release(); await wait(700);
        assert(document.activeElement === chosen, `${choice} did not cancel delayed recovery`);
      } finally { held.close(); audit.close(); }
    });
  }
  await check("Back after external Stop gives a page fallback without choosing the duplicate relationship", async () => {
    const audit = await mountUiAudit();
    try {
      await audit.go("/", { player: "paused" });
      const link = control('[data-now-playing] [data-media-context] a');
      const href = link.getAttribute("href");
      input(link); await wait();
      assert(audit.router.state.location.pathname === "/collection", "Relationship did not navigate");
      await audit.stopPlayback();
      audit.router.history.back(); await wait(650);
      assert(audit.router.state.location.pathname === "/", "Back did not return Home");
      const duplicate = control('[data-home-hero] [data-media-context] a');
      assert(duplicate.getAttribute("href") === href, "Home must retain the identical destination in a different scope");
      assert(document.activeElement === control('[data-home-hero] [data-page-first]'), `Missing opener left focus on ${document.activeElement?.tagName}`);
      assert(document.activeElement !== duplicate, "Back must not restore an identical destination from another scope");
    } finally { audit.close(); }
  });
  await check("Back keeps the exact bar relationship eligible if playback returns after its fallback", async () => {
    const audit = await mountUiAudit();
    try {
      await audit.go("/", { player: "paused" });
      input(control('[data-now-playing] [data-media-context] a')); await wait();
      await audit.stopPlayback();
      audit.router.history.back(); await wait(400);
      assert(document.activeElement === control('[data-home-hero] [data-page-first]'), "Back needs a page fallback while the bar is missing");
      await audit.resumePlayback(); await wait();
      assert(document.activeElement === control('[data-now-playing] [data-media-context] a'), "The returning exact bar opener must replace its provisional page fallback");
    } finally { audit.close(); }
  });
  for (const cancel of [false, true]) {
    await check(`Back's provisional fallback ${cancel ? "yields to deliberate focus" : "hands off to the exact delayed opener"}`, async () => {
      const audit = await mountUiAudit();
      let held: ReturnType<typeof holdReads> | undefined;
      try {
        await audit.go("/", { fresh: true });
        const link = control('[data-home-hero] [data-media-context] a');
        const href = link.getAttribute("href");
        input(link); await wait();
        held = holdReads(["/api/progress/history"]);
        audit.client.clear();
        audit.router.history.back(); await wait(400);
        assert(audit.router.state.location.pathname === "/" && !document.querySelector('[data-home-hero]'), "Home opener must still be loading");
        assert(document.activeElement !== document.body && document.activeElement?.closest('[data-page="Home"]'), "Back needs a usable provisional page fallback");
        const chosen = outside();
        if (cancel) { chosen.focus(); chosen.blur(); }
        const focus = document.activeElement;
        held.release(); await wait(700);
        const opener = control('[data-home-hero] [data-media-context] a');
        assert(opener.getAttribute("href") === href, "The exact relationship must return");
        assert(document.activeElement === (cancel ? focus : opener), cancel ? "Delayed opener stole a deliberate choice" : "Delayed exact opener never replaced the fallback");
      } finally { held?.close(); audit.close(); }
    });
  }
  if (includeTimeout) await check("Stop recovery expires before a very late hero loads", async () => {
    const audit = await mountUiAudit();
    const held = holdReads(["/api/progress/history"]);
    try {
      await audit.go("/", { player: "paused", fresh: true });
      stopFromBar(); await audit.stopPlayback();
      const provisional = document.activeElement;
      await wait(15_200);
      held.release(); await wait(700);
      assert(document.querySelector('[data-home-hero] [data-page-first]'), "The late hero must load");
      assert(document.activeElement === provisional, "Recovery moved focus after its 15-second limit");
    } finally { held.close(); audit.close(); }
  });
  return results;
}
