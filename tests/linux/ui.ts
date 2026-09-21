import { strict as assert } from "node:assert";

type Request = (path: string, body?: unknown, method?: string) => Promise<any>;
export type Wait = (description: string, predicate: () => boolean | Promise<boolean>, timeout?: number) => Promise<void>;

export const keys = { tab: "\uE004", enter: "\uE007", shift: "\uE008", escape: "\uE00C", end: "\uE010", home: "\uE011", left: "\uE012", up: "\uE013", right: "\uE014", down: "\uE015" };

// Use the same W3C interactions for Tauri's webview and the real HTTP browser.
export class UiDriver {
  constructor(readonly request: Request, readonly session: () => string) {}

  execute = (script: string, args: unknown[] = []) => this.request(`/session/${this.session()}/execute/sync`, { script, args });

  async element(selector: string) {
    if (/^#media-(url|title|kind|quality)$/.test(selector)) await this.addMedia();
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return (await this.request(`/session/${this.session()}/element`, { using: "css selector", value: selector }))["element-6066-11e4-a52e-4f735466cecf"] as string;
      } catch (error) {
        lastError = error;
        if (!String(error).includes("no such element")) throw error;
        await Bun.sleep(50);
      }
    }
    throw lastError;
  }

  async waitFor(description: string, predicate: () => Promise<boolean>) {
    const deadline = Date.now() + 5_000;
    while (!await predicate()) {
      assert.ok(Date.now() < deadline, description);
      await Bun.sleep(50);
    }
  }

  async home() {
    if (!await this.execute("return !!document.querySelector('.tv-browser[hidden]')")) return;
    if (await this.execute("return !!document.querySelector('.tv-playback-controls[hidden]')")) await this.key("i");
    await this.waitFor("TV Home or its playback navigation becomes visible", () => this.execute("return !!document.querySelector('.tv-browser:not([hidden]), .tv-playback-controls:not([hidden])')"));
    // An observed Stop can open Home while its navigation is being revealed.
    if (await this.execute("return !!document.querySelector('.tv-browser:not([hidden])')")) return;
    await this.button("Show TV home");
    await this.waitFor("TV Home becomes visible", () => this.execute("return !!document.querySelector('.tv-browser:not([hidden])')"));
  }

  async browse() {
    await this.home();
    if (await this.execute("return !!document.querySelector('.remote-control') && innerWidth < 960")) await this.button("Browse", ".mode-switch");
  }

  async controls() {
    if (await this.execute("return !!document.querySelector('.tv-browser:not([hidden])')")) await this.button("Show TV controls");
    else if (await this.execute("return !!document.querySelector('.tv-playback-controls[hidden]')")) await this.key("i");
    else if (await this.execute("return !!document.querySelector('.remote-browse, .remote-session') && innerWidth < 960")) await this.button("Remote", ".mode-switch");
    await this.waitFor("Playback controls become visible", () => this.execute("const native = document.querySelector('.tv-playback-controls:not([hidden]) .player-controls'); const remote = !document.querySelector('.tv-shell') && document.querySelector('.player-controls'); return !!(native || remote) && (native ?? remote).getClientRects().length > 0 && !(native ?? remote).closest('[hidden]')"));
  }

  async watching() {
    if (!await this.execute("return !!document.querySelector('.tv-shell')")) return;
    if (await this.execute("return !!document.querySelector('.tv-browser:not([hidden])')")) await this.button("Show playback");
    if (await this.execute("return !!document.querySelector('.tv-playback-controls:not([hidden])')")) await this.button("Hide playback controls");
    await this.waitFor("TV browser and playback overlay close before native pixel capture", () => this.execute("return !!document.querySelector('.tv-browser[hidden]') && !!document.querySelector('.tv-playback-controls[hidden]') && !document.querySelector('[role=dialog], [role=listbox], [data-slot=popover-content]')"));
    await Bun.sleep(350);
  }

  async addMedia() {
    await this.browse();
    if (await this.execute("return !!document.querySelector('[role=dialog] #media-url')")) return;
    if (await this.execute("const input = document.querySelector('#media-url'); return !!input && input.getClientRects().length > 0 && !input.closest('[hidden]')")) return;
    await this.section("Now");
    await this.button("Add media");
    await this.waitFor("Add media dialog opens", () => this.execute("return !!document.querySelector('[role=dialog] #media-url')"));
  }

  async revealElement(id: string) {
    const location = await this.execute("const element = arguments[0]; const visible = element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible' && !element.closest('[hidden]'); return { browser: !!element.closest('.tv-browser[hidden]'), controls: !visible && !!element.closest('.player-controls'), pad: !visible && !!element.closest('.remote-pad') };", [{ "element-6066-11e4-a52e-4f735466cecf": id }]);
    if (location.browser) await this.home();
    if (location.controls || location.pad) await this.controls();
  }

  async click(selector: string) {
    // React can replace a stable-looking selector target before WebDriver
    // resolves it. Retry only that lookup: after an element handle exists, a
    // stale-node failure must stop because the click may already have applied.
    let lastError: unknown;
    let id: string | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      try { id = await this.element(selector); break; }
      catch (error) {
        lastError = error;
        if (!String(error).includes("Node with identifier")) throw error;
        await Bun.sleep(50);
      }
    }
    if (!id) throw lastError;
    return await this.clickElement(id, selector);
  }

  async clickElement(id: string, selector?: string) {
    await this.revealElement(id);
    await settlePortals(this);
    const element = { "element-6066-11e4-a52e-4f735466cecf": id };
    const deadline = Date.now() + 5_000;
    let previous = "";
    while (true) {
      const point = await this.execute(`
        const element = arguments[0];
        element.scrollIntoView({ block: 'center', inline: 'nearest' });
        const rect = element.getBoundingClientRect();
        const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        return !element.matches(':disabled') && rect.width > 0 && rect.height > 0 && element.contains(hit) ? JSON.stringify([x, y, rect.width, rect.height]) : '';
      `, [element]);
      if (point && point === previous) break;
      if (Date.now() >= deadline) {
        const target = await this.execute("const el=arguments[0], rect=el.getBoundingClientRect(); return { target:el.outerHTML, rect:rect.toJSON(), hit:document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.outerHTML.slice(0,500) };", [element]);
        assert.fail(`Click target becomes enabled, unobstructed and stable: ${JSON.stringify(target)}`);
      }
      previous = point;
      await Bun.sleep(50);
    }
    await this.request(`/session/${this.session()}/element/${id}/click`, {});
  }

  async type(selector: string, text: string) {
    const id = await this.element(selector);
    await this.clickElement(id, selector);
    await this.request(`/session/${this.session()}/element/${id}/clear`, {});
    if (text) await this.request(`/session/${this.session()}/element/${id}/value`, { text });
  }

  async key(value: string, shift = false) {
    const actions = [
      ...(shift ? [{ type: "keyDown", value: keys.shift }] : []),
      { type: "keyDown", value }, { type: "keyUp", value },
      ...(shift ? [{ type: "keyUp", value: keys.shift }] : []),
    ];
    await this.request(`/session/${this.session()}/actions`, { actions: [{ type: "key", id: "keyboard", actions }] });
  }

  async button(label: string, scope = "") {
    if (!scope && label === "Settings" && await this.execute("return !!document.querySelector('.primary-nav a[data-source=Settings]')")) return this.section("Settings");
    const matches = await this.execute(`return [...document.querySelectorAll(arguments[0] + ' button')].filter(button =>
      button.getAttribute('aria-label') === arguments[1] || button.textContent.trim() === arguments[1]);`, [scope, label]);
    assert.equal(matches.length, 1, `One ${label} button exists in ${scope || "the page"}`);
    const id = matches[0]!["element-6066-11e4-a52e-4f735466cecf"];
    const selector = await this.execute(`return [...document.querySelectorAll(arguments[0] + ' button')].filter(button =>
      button.getAttribute('aria-label') === arguments[1] || button.textContent.trim() === arguments[1]).map(button => button.getAttribute('aria-label')
        ? '[aria-label="' + button.getAttribute('aria-label').replaceAll('"', '\\\\"') + '"]'
        : 'xpath=//button[normalize-space()="' + button.textContent.trim().replaceAll('"', '\\\\"') + '"]')[0];`, [scope, label]);
    await this.clickElement(id, selector);
  }

  async section(label: string) {
    await this.browse();
    if (await this.execute("return !!document.querySelector('.primary-nav')")) {
      const destination = label === "For later" ? "Saved" : label === "Online" ? "Library" : label;
      const libraryLabel = ({ Files: "TV folders", Radio: "Radio", Guide: "Live TV", Jellyfin: "Jellyfin" } as Record<string, string>)[destination];
      await this.click(`.primary-nav a[data-source="${libraryLabel ? "Library" : destination}"]`);
      if (libraryLabel) {
        await this.waitFor("Library page opens before choosing its source", () => this.execute('return !!document.querySelector(\'[data-page="Library"]:not([hidden])\')'));
        await this.button(libraryLabel, '[data-page="Library"]:not([hidden])');
      }
      await this.waitFor(`${label} page opens`, () => this.execute('return !!document.querySelector(arguments[0])', [`[data-page="${destination}"]:not([hidden])`]));
      return;
    }
    // The installed update fixture still exercises the retained older release.
    const matches = await this.execute("return [...document.querySelectorAll('.source-nav [role=tab]')].filter(tab => tab.getAttribute('data-source') === arguments[0])", [label === "Files" ? "Library" : label]);
    assert.equal(matches.length, 1, `One ${label} source tab exists`);
    await this.clickElement(matches[0]["element-6066-11e4-a52e-4f735466cecf"]);
  }

  async settingsSection(section: string) {
    if (await this.execute("return !!document.querySelector('[aria-label=\"Settings pages\"]')")) {
      const destination = section === "remotes" ? "connection" : section === "remote" ? "playback" : section;
      const category = ".settings-page:not([hidden]) .settings-category select";
      if (await this.execute("return !!document.querySelector(arguments[0])?.getClientRects().length", [category])) {
        const option = await this.element(`${category} option[value="${destination}"]`);
        // WebDriver's option click selects the native option and dispatches input/change.
        await this.request(`/session/${this.session()}/element/${option}/click`, {});
      } else {
        const target = `[aria-label="Settings pages"] [data-settings-page="${destination}"]`;
        if (await this.execute("return !!document.querySelector('[role=dialog] .settings-back')")) await this.button("All settings", '[role="dialog"]');
        await this.click(target);
      }
      await this.waitFor(`Settings selects ${section}`, () => this.execute('return document.querySelector(arguments[0])?.getAttribute("aria-current") === "page"', [`[aria-label="Settings pages"] [data-settings-page="${destination}"]`]));
      return;
    }
    // A/B update qualification retains its original flat and grouped Settings.
    const selector = (value: string) => `[aria-label="Settings sections"] [role="tab"][id$="-trigger-${value}"]`;
    await this.waitFor("Settings navigation is rendered", () => this.execute('return !!document.querySelector(\'[role="dialog"] [aria-label="Settings sections"]\')'));
    const grouped = await this.execute('return !!document.querySelector("[data-settings-group]") || [...document.querySelectorAll(\'[role="dialog"] button\')].some(button => button.textContent.trim() === "All settings")');
    if (grouped && !await this.execute("return !!document.querySelector(arguments[0])", [selector(section)])) {
      if (await this.execute('return !document.querySelector("[data-settings-group]")')) await this.button("All settings", '[role="dialog"]');
      const group = section === "playback" ? "profile" : ["appearance", "connection", "remote"].includes(section) ? "device" : "tv";
      const entry = `[data-settings-group="${group}"]`;
      await this.waitFor(`Settings offers the ${group} group`, () => this.execute("return !!document.querySelector(arguments[0])", [entry]));
      await this.click(entry);
    }
    const target = selector(!grouped && section === "tv-appearance" ? "appearance" : !grouped && section === "remotes" ? "connection" : section);
    await this.waitFor(`Settings offers ${section}`, () => this.execute("return !!document.querySelector(arguments[0])", [target]));
    await this.click(target);
    await this.waitFor(`Settings selects ${section}`, () => this.execute('return document.querySelector(arguments[0])?.getAttribute("aria-selected") === "true"', [target]));
  }

  async select(selector: string, label: string) {
    await this.click(selector);
    const deadline = Date.now() + 5_000;
    let options: any[] = [];
    while (!options.length) {
      options = await this.execute("return [...document.querySelectorAll('[role=option]')].filter(option => option.textContent.trim() === arguments[0])", [label]);
      if (Date.now() > deadline) throw new Error(`${selector} did not offer ${label}`);
      if (!options.length) await Bun.sleep(50);
    }
    assert.equal(options.length, 1, `One ${label} select option exists`);
    await this.clickElement(options[0]["element-6066-11e4-a52e-4f735466cecf"]);
    const closeDeadline = Date.now() + 5_000;
    while (!await this.execute("return !document.querySelector('[role=listbox]') && document.querySelector(arguments[0])?.textContent.trim() === arguments[1]", [selector, label])) {
      assert.ok(Date.now() < closeDeadline, `${selector} closes and displays ${label}`);
      await Bun.sleep(50);
    }
  }
}

export const qualityLabel = (value: string) => value === "auto" ? "1080p (recommended)" : value === "best" ? "Unrestricted quality" : `Up to ${value}`;

async function settlePortals(ui: UiDriver) {
  const deadline = Date.now() + 5_000;
  while (await ui.execute(`return [...document.querySelectorAll('[data-slot=dialog-content], [data-slot=select-content], [data-slot=popover-content]')].some(portal => {
    const rect = portal.getBoundingClientRect();
    let zoom = 1;
    for (let element = portal; element; element = element.parentElement) zoom *= parseFloat(getComputedStyle(element).zoom) || 1;
    return Math.abs(rect.width / zoom - portal.offsetWidth) > 0.75 || Math.abs(rect.height / zoom - portal.offsetHeight) > 0.75 || portal.getAnimations().some(animation => animation.playState === 'running');
  })`)) {
    assert.ok(Date.now() < deadline, "Portal opening animations settle before measuring controls");
    await Bun.sleep(50);
  }
}

export async function assertTheme(ui: UiDriver) {
  const theme = await ui.execute(`
    const root = getComputedStyle(document.documentElement);
    const button = document.querySelector('[data-slot=button].bg-primary');
    if (!button) return null;
    const actual = getComputedStyle(button);
    const probe = document.createElement('span');
    probe.style.color = 'var(--primary)';
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { primary: root.getPropertyValue('--primary').trim(), background: root.getPropertyValue('--background').trim(),
      actual: actual.backgroundColor, expected, display: actual.display, radius: actual.borderRadius, font: getComputedStyle(document.body).fontFamily };
  `);
  assert.ok(theme?.primary && theme?.background, "Generated shadcn theme variables are present");
  assert.equal(theme.actual, theme.expected, "Tailwind bg-primary uses the generated theme");
  assert.ok(["flex", "inline-flex"].includes(theme.display), "Generated button layout utilities are compiled");
  assert.ok(parseFloat(theme.radius) > 0, "Generated radius utilities are compiled");
  assert.ok(theme.font.includes("Inter Variable"), "The requested Mira preset font is bundled");
  return theme;
}

export async function assertResponsive(ui: UiDriver, description: string) {
  await settlePortals(ui);
  const layout = await ui.execute(`
    const visible = element => element.getClientRects().length && getComputedStyle(element).visibility === 'visible';
    const describe = element => ({ label: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 120),
      selector: element.id ? '#' + element.id : element.tagName.toLowerCase() + [...element.classList].map(name => '.' + name).join(''),
      rect: element.getBoundingClientRect().toJSON(), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth });
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll('body *')].filter(visible).filter(element => element.getBoundingClientRect().right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 2 && !element.closest('[hidden]')).slice(0, 20).map(describe),
      clipped: [...document.querySelectorAll('button')].filter(visible).filter(element =>
        element.scrollWidth > element.clientWidth + 2 && !element.matches('[role=combobox]') && !element.querySelector('.truncate')
      ).map(element => element.getAttribute('aria-label') || element.textContent.trim()),
      small: [...document.querySelectorAll('button:not(:disabled), input:not(:disabled), [data-slot=slider]')].filter(visible).map(element => {
        const rect = element.getBoundingClientRect();
        return { label: element.getAttribute('aria-label') || element.textContent.trim() || element.id, width: rect.width, height: rect.height };
      }).filter(rect => rect.width < 43.5 || rect.height < 43.5) };
  `);
  assert.equal(layout.width, 390, `${description} uses a 390px phone viewport`);
  assert.ok(layout.scrollWidth <= layout.width + 1, `${description} has no horizontal page overflow: ${JSON.stringify(layout)}`);
  assert.deepEqual(layout.clipped, [], `${description} button text stays inside its controls`);
  assert.deepEqual(layout.small, [], `${description} controls have at least 44px touch targets`);
  console.log(`PASS ${description}: 390px viewport, 44px touch targets and no page overflow`);
}

export async function assertNativePortal(ui: UiDriver, selector: string, artifacts: string, name: string) {
  await settlePortals(ui);
  const sample = await ui.execute(`
    const portal = document.querySelector(arguments[0]);
    const rect = portal.getBoundingClientRect();
    const stage = document.querySelector('.video-stage').getBoundingClientRect();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.fillStyle = getComputedStyle(portal).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return { x: Math.ceil(rect.x + 4), y: Math.ceil(rect.y + 30), width: 6, height: Math.floor(rect.height - 60),
      color: [...context.getImageData(0, 0, 1, 1).data], viewport: [innerWidth, innerHeight, devicePixelRatio],
      overlapsVideo: rect.x >= stage.x && rect.y >= stage.y && rect.right <= stage.right && rect.bottom <= stage.bottom };
  `, [selector]);
  assert.deepEqual(sample.viewport, [1600, 1000, 1], "Fullscreen CSS coordinates match the X11 display");
  assert.ok(sample.overlapsVideo && sample.height > 0, `${name} overlaps the native video aperture`);
  assert.equal(sample.color[3], 255, `${name} has an opaque background`);
  const path = `${artifacts}/${name}.png`;
  const started = performance.now();
  const attempts: { elapsedMs: number; matches: number }[] = [];
  for (;;) {
    const capture = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab", "-video_size", "1600x1000", "-i", process.env.DISPLAY!, "-frames:v", "1", path], { stdout: "ignore", stderr: "inherit" });
    assert.equal(await capture.exited, 0);
    const decode = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { stdout: "pipe", stderr: "inherit" });
    const pixels = new Uint8Array(await new Response(decode.stdout).arrayBuffer());
    assert.equal(await decode.exited, 0);
    let matches = 0;
    for (let y = sample.y; y < sample.y + sample.height; y++) for (let x = sample.x; x < sample.x + sample.width; x++) {
      const offset = (y * 1600 + x) * 3;
      if (sample.color.slice(0, 3).every((value: number, index: number) => Math.abs(pixels[offset + index]! - value) <= 2)) matches++;
    }
    attempts.push({ elapsedMs: performance.now() - started, matches });
    await Bun.write(`${artifacts}/${name}-paint.json`, JSON.stringify({ sample, minimumRatio: 0.75, attempts }, null, 2));
    // Native paint can follow stable DOM geometry and finished CSS animations.
    // The narrow edge avoids controls; a dialog footer can have its own background.
    if (matches >= sample.width * sample.height * 0.75) return;
    if (attempts.length === 1) await Bun.write(`${artifacts}/${name}-first.png`, Bun.file(path));
    assert.ok(performance.now() - started < 3_000, `${name} paints above native video (${matches}/${sample.width * sample.height} background pixels)`);
    await Bun.sleep(50);
  }
}

export async function startHttpRemote(origin: string, code: string, artifacts: string, until: Wait, port = 4446, scale = 1.25) {
  const endpoint = `http://127.0.0.1:${port}`;
  const name = port === 4446 ? "http" : `http-${port}`;
  const windowClass = port === 4446 ? "CouchHttpTest" : `CouchHttpTest${port}`;
  const browserDriver = Bun.spawn(["WebKitWebDriver", `--port=${port}`], { env: { ...process.env, GDK_DPI_SCALE: String(scale) }, stdout: Bun.file(`${artifacts}/${name}-driver.log`), stderr: Bun.file(`${artifacts}/${name}-browser.log`) });
  let session = "";
  const request: Request = async (path, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(`${endpoint}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const result = await response.json() as { value: any };
    if (!response.ok || result.value?.error) throw new Error(`HTTP browser WebDriver ${path}: ${result.value?.message || result.value?.error || response.status}`);
    return result.value;
  };
  const ui = new UiDriver(request, () => session);
  const close = async () => {
    if (session) await request(`/session/${session}`, undefined, "DELETE").catch(() => {});
    browserDriver.kill();
    await browserDriver.exited;
  };
  try {
    await until("HTTP remote browser driver is ready", async () => { try { return (await fetch(`${endpoint}/status`)).ok; } catch { return false; } });
    session = (await request("/session", { capabilities: { alwaysMatch: { browserName: "MiniBrowser", timeouts: { implicit: 5_000 }, "webkitgtk:browserOptions": { args: ["--automation", `--class=${windowClass}`] } } } })).sessionId;
    await request(`/session/${session}/url`, { url: origin });
    await until("compiled Bun HTTP app displays its real pairing form", async () => !!await ui.execute("return document.querySelector('#pairing-code') && !window.__TAURI_INTERNALS__"));
    // MiniBrowser chrome has a 447px minimum. A 1.25 display scale permits a
    // real 390 CSS-pixel viewport without changing any application styles.
    await request(`/session/${session}/window/rect`, { x: 1000, y: 0, width: 390, height: 900 });
    const rect = await request(`/session/${session}/window/rect`);
    const width = await ui.execute("return innerWidth");
    await request(`/session/${session}/window/rect`, { width: Math.round(rect.width * 390 / width), height: 900 });
    await until("HTTP remote viewport is phone sized", async () => await ui.execute("return innerWidth") === 390);
    // WebKit can expose the new innerWidth before replacement fonts finish
    // loading. Let those frames settle; overflow itself remains an assertion
    // failure with named elements.
    await ui.waitFor("Phone viewport fonts settle after resize", async () => {
      const fonts = await request(`/session/${session}/execute/async`, {
        script: "const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(() => document.fonts.ready.then(() => done(document.fonts.status))));", args: [],
      });
      return fonts === "loaded";
    });
    // Measure through the live selector because React replaces state-bound
    // handles. WebDriver performs one click; stale dispatch is fatal, never
    // retried, because the action may already have applied.
    ui.clickElement = async (id, selector) => {
      assert.ok(selector, "HTTP clicks use selectors because state updates can invalidate handles");
      let point: { x: number; y: number; width: number; height: number } | null = null;
      // React may replace the node before the click is sent. Retrying this
      // preparation is safe; after WebDriver dispatch there is no retry.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await ui.waitFor("HTTP click target becomes visible and unobstructed", async () => {
            await ui.execute("const element = arguments[0].startsWith('xpath=') ? document.evaluate(arguments[0].slice(6), document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue : document.querySelector(arguments[0]); if (!element) return false; const rect = element.getBoundingClientRect(); if (!element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))) element.scrollIntoView({ block: 'center', inline: 'nearest' })", [selector]);
            await request(`/session/${session}/execute/async`, { script: "const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(() => done(null)));", args: [] });
            const measured = await ui.execute(`const element = arguments[0].startsWith('xpath=') ? document.evaluate(arguments[0].slice(6), document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue : document.querySelector(arguments[0]); if (!element) return ''; const rect = element.getBoundingClientRect();
          const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
          return !element.matches(':disabled') && rect.width > 0 && rect.height > 0 && element.contains(document.elementFromPoint(x, y))
            ? JSON.stringify({ x: x * devicePixelRatio, y: outerHeight - innerHeight * devicePixelRatio + y * devicePixelRatio, width: rect.width, height: rect.height }) : '';`, [selector]);
            if (!measured) return false;
            point = JSON.parse(measured);
            return true;
          });
          break;
        } catch (error) {
          if (!String(error).includes("Node with identifier")) throw error;
          await Bun.sleep(50);
        }
      }
      if (!point) assert.fail("HTTP click target resolves to an unobstructed pre-dispatch node");
      await ui.execute("const element = arguments[0].startsWith('xpath=') ? document.evaluate(arguments[0].slice(6), document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue : document.querySelector(arguments[0]); if (!element) throw new Error('Click target disappeared'); element.click();", [selector]);
    };
    await assertResponsive(ui, "Phone pairing");
    await ui.type("#pairing-code", code);
    await until("HTTP pairing form enables Connect for a complete code", async () => await ui.execute("return document.querySelector('#pairing-code')?.value.length === 6 && !document.querySelector('.pair-form button')?.disabled"));
    await ui.click(".pair-form button[type=submit], .pair-form button:not([type])");
    await until("real HTTP remote pairs and receives current playback", async () => await ui.execute("return document.querySelector('.header-status [role=status]')?.textContent") === "Connected");
    const theme = await assertTheme(ui);
    await assertResponsive(ui, "Phone queue");
    return { ui, theme, close, refresh: () => request(`/session/${session}/refresh`, {}),
      minimize: () => request(`/session/${session}/window/minimize`, {}),
      restore: () => request(`/session/${session}/window/rect`, { x: 1000, y: 0, width: Math.round(390 * scale), height: 900 }),
      screenshot: async (name: string) => { const png = await request(`/session/${session}/screenshot`); await Bun.write(`${artifacts}/${name}.png`, Buffer.from(png, "base64")); } };
  } catch (error) {
    const diagnostics = await ui.execute("return { alerts: [...document.querySelectorAll('[role=alert]')].map(element => element.textContent), status: document.querySelector('.header-status')?.textContent, codeLength: document.querySelector('#pairing-code')?.value.length, connectDisabled: document.querySelector('.pair-form button')?.disabled, viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio } }").catch(() => null);
    await Bun.write(`${artifacts}/${name}-failure.json`, JSON.stringify(diagnostics, null, 2));
    await ui.execute("document.querySelector('#pairing-code')?.setAttribute('type', 'password')").catch(() => {});
    const png = await request(`/session/${session}/screenshot`).catch(() => null);
    if (png) await Bun.write(`${artifacts}/${name}-failure.png`, Buffer.from(png, "base64"));
    await close();
    throw error;
  }
}
