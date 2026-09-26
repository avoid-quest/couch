import { settingsPages, type SettingsPage } from "../../src/shared/settings-pages";
import { strict as assert } from "node:assert";

type Request = (path: string, body?: unknown, method?: string) => Promise<any>;
export type Wait = (description: string, predicate: () => boolean | Promise<boolean>, timeout?: number) => Promise<void>;

export const keys = { tab: "\uE004", enter: "\uE007", shift: "\uE008", escape: "\uE00C", end: "\uE010", home: "\uE011", left: "\uE012", up: "\uE013", right: "\uE014", down: "\uE015" };

// Use the same W3C interactions for Tauri's webview and the real HTTP browser.
export class UiDriver {
  constructor(readonly request: Request, readonly session: () => string) {}

  execute = (script: string, args: unknown[] = []) => this.request(`/session/${this.session()}/execute/sync`, { script, args });

  async elements(using: "css selector" | "xpath", value: string) {
    return this.request(`/session/${this.session()}/elements`, { using, value }) as Promise<Array<{ "element-6066-11e4-a52e-4f735466cecf": string }>>;
  }

  async text(id: string) { return this.request(`/session/${this.session()}/element/${id}/text`); }
  async attribute(id: string, name: string) { return this.request(`/session/${this.session()}/element/${id}/attribute/${name}`); }

  async roleHasText(role: string, text: string) {
    for (const element of await this.elements("css selector", `[role="${role}"]`)) try {
      if ((await this.text(element["element-6066-11e4-a52e-4f735466cecf"])).trim() === text) return true;
    } catch { /* Status nodes can re-render between lookup and read. */ }
    return false;
  }

  async pairingCode() {
    const [qr] = await this.elements("xpath", '//*[@role="img" and starts-with(@aria-label, "Pair another device with code ")]');
    assert.ok(qr, "Pairing QR exists");
    const code = (await this.attribute(qr["element-6066-11e4-a52e-4f735466cecf"], "aria-label")).match(/\b\d{6}\b/)?.[0];
    assert.ok(code, "Pairing QR exposes a six-digit code");
    return code;
  }

  async addDirectMedia(url: string) {
    await this.section("Find");
    await this.type("#media-search", url);
    await this.waitFor("Pasted link offers direct media", () => this.execute("return !!document.querySelector('[aria-label=\"Pasted link\"]')"));
    await this.button("Direct media", '[aria-label="Pasted link"]');
    await this.button("Queue", '[aria-label="Pasted link"]');
  }

  async element(selector: string) {
    return (await this.request(`/session/${this.session()}/element`, { using: "css selector", value: selector }))["element-6066-11e4-a52e-4f735466cecf"] as string;
  }

  async waitFor(description: string, predicate: () => Promise<boolean>) {
    const deadline = Date.now() + 5_000;
    while (!await predicate()) {
      assert.ok(Date.now() < deadline, description);
      await Bun.sleep(50);
    }
  }

  async home() {
    await this.section("Find");
  }

  async browse() {
    if (await this.execute("return !!document.querySelector('[data-page=Now]')")) await this.home();
  }

  async controls() {
    await this.section("Now");
    if (await this.execute("return !!document.querySelector('[data-player-band=hidden]')")) await this.key("i");
    await this.waitFor("Playback controls become visible", () => this.execute("return !!document.querySelector('[data-player-band=shown]')"));
  }

  async watching() {
    await this.controls();
    await this.waitFor("Player dialogs close before native pixel capture", () => this.execute("return !document.querySelector('[role=dialog], [role=listbox], [data-slot=popover-content]')"));
    await Bun.sleep(350);
  }

  async revealElement(id: string, selector?: string) {
    const hiddenPlayer = await this.execute("const element = arguments[1] ? document.querySelector(arguments[1]) : arguments[0]; return !!element?.closest('[data-player-band=hidden]')", [selector ? null : { "element-6066-11e4-a52e-4f735466cecf": id }, selector]);
    if (hiddenPlayer) await this.key("i");
  }

  async click(selector: string) {
    await this.clickElement("", selector);
  }

  async clickElement(id: string, selector?: string) {
    await this.revealElement(id, selector);
    await settlePortals(this);
    const scale = await this.execute("return devicePixelRatio");
    if (scale === 1) {
      const target = selector ? await this.element(selector) : id;
      await this.waitFor("Click target is enabled", () => this.request(`/session/${this.session()}/element/${target}/enabled`));
      return this.request(`/session/${this.session()}/element/${target}/click`, {});
    }
    // WebKitGTK element-click misses fractional-DPI targets; pointer actions take device pixels.
    const element = selector ? null : { "element-6066-11e4-a52e-4f735466cecf": id };
    let point = "";
    try { await this.waitFor("Click target is enabled and unobstructed", async () => {
      point = await this.execute(`
        const element = arguments[1] ? document.querySelector(arguments[1]) : arguments[0];
        element.scrollIntoView({ block: 'center', inline: 'nearest' });
        const rect = element.getBoundingClientRect();
        const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        return !element.matches(':disabled') && rect.width > 0 && rect.height > 0 && element.contains(document.elementFromPoint(x, y)) ? JSON.stringify([x, y]) : '';
      `, [element, selector]);
      return !!point;
    }); } catch (error) {
      const details = await this.execute(`
        const element = arguments[1] ? document.querySelector(arguments[1]) : arguments[0];
        const rect = element.getBoundingClientRect();
        return { disabled: element.matches(':disabled'), rect: rect.toJSON(), hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.outerHTML.slice(0, 300) };
      `, [element, selector]);
      throw new Error(`Click target is blocked: ${JSON.stringify(details)}`, { cause: error });
    }
    const [x, y] = JSON.parse(point);
    await this.request(`/session/${this.session()}/actions`, { actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: [
      { type: "pointerMove", duration: 0, origin: "viewport", x: Math.round(x * scale), y: Math.round(y * scale) },
      { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 },
    ] }] });
  }

  async type(selector: string, text: string) {
    const id = await this.element(selector);
    return this.typeElement(id, text);
  }

  async typeElement(id: string, text: string) {
    await this.clickElement(id);
    if (!text) { await this.key(keys.home); await this.key(keys.end, true); await this.key("\uE003"); return; }
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
    if (!scope && label === "Settings" && await this.execute("return !!document.querySelector('[data-app-nav] a[href^=\"/settings\"]')")) return this.section("Settings");
    const matches = () => this.execute(`return [...document.querySelectorAll(arguments[0] + ' button')].filter(button =>
      button.getAttribute('aria-label') === arguments[1] || button.textContent.trim() === arguments[1]);`, [scope, label]);
    await this.waitFor(`One ${label} button exists in ${scope || "the page"}`, async () => (await matches()).length === 1);
    const [button] = await matches();
    try { await this.clickElement(button["element-6066-11e4-a52e-4f735466cecf"]); }
    catch (error) { throw new Error(`Could not click ${label}`, { cause: error }); }
  }

  async section(label: string) {
    const source = ({ Files: "Folders", Library: "Folders", Radio: "Radio playlists", Jellyfin: "Jellyfin" } as Record<string, string>)[label];
    const destination = label === "Queue" || label === "Now" ? "Now" : label === "For later" ? "Saved" : source || ["Online", "Home", "Search"].includes(label) ? "Find" : label;
    if (destination === "Now") {
      if (!await this.execute("return !!document.querySelector('[data-page=Now]')")) {
        await this.click('[data-app-status] a[href="/"]');
      }
      await this.waitFor("Now or Up next opens", () => this.execute("return !!document.querySelector('[data-page=Now]')"));
      if (label === "Queue" && !await this.execute("return !!document.querySelector('[data-queue-panel]')")) {
        if (await this.execute("return !!document.querySelector('[data-player-sheet]')")) await this.key(keys.escape);
        await this.click('[data-panel="queue"]');
      }
      return;
    }
    if (await this.execute("return !!document.querySelector('.player-page')")) {
      if (await this.execute("return !!document.querySelector('[data-player-sheet]')")) await this.key(keys.escape);
      await this.click(".player-page [data-back]");
    }
    else if (await this.execute("return !!document.querySelector('[data-player-idle]')")) await this.request(`/session/${this.session()}/url`, { url: new URL(`/${destination.toLowerCase()}`, await this.execute("return location.href")).href });
    const target = `[data-app-nav] a[href^="/${destination.toLowerCase()}"]`;
    await this.waitFor(`${label} navigation is rendered`, () => this.execute("return !!document.querySelector(arguments[0])", [target]));
    await this.click(target);
    await this.waitFor(`${label} page opens`, () => this.execute("return !!document.querySelector(arguments[0])", [`[data-page="${destination}"]`]));
    if (label === "Home" && await this.execute("return !!location.search")) await this.request(`/session/${this.session()}/url`, { url: new URL("/find", await this.execute("return location.href")).href });
    if (source) {
      const url = new URL(await this.execute("return location.href"));
      url.searchParams.set("source", source);
      await this.request(`/session/${this.session()}/url`, { url: url.href });
      await this.waitFor(`${source} filter is selected`, () => this.execute("return new URLSearchParams(location.search).get('source') === arguments[0] && !!document.querySelector('#media-search')", [source]));
    }
    return;
  }

  async settingsSection(section: string): Promise<void> {
    if (await this.execute("return !!document.querySelector('[aria-label=\"Settings pages\"]')")) {
      if (section.startsWith("source-")) {
        await this.settingsSection("sources");
        await this.click(`[aria-label="Sources"] a[href$="${settingsPages[section as SettingsPage].path}"]`);
        await this.waitFor(`${section} opens`, () => this.execute("return document.querySelector('section[aria-label=Settings] h2')?.textContent === arguments[0]", [settingsPages[section as SettingsPage].label]));
        return;
      }
      if (section === "tv-appearance") {
        if (await this.execute("return !!document.querySelector('.tv-shell')")) return this.settingsSection("appearance");
        // Retained administrator deep link has no primary navigation item.
        const url = new URL("/settings/tv-appearance", await this.execute("return location.href")).href;
        await this.request(`/session/${this.session()}/url`, { url });
        await this.waitFor("TV appearance route reconnects", () => this.execute("return document.querySelector('[data-app-status] [role=status]')?.textContent === 'Connected'"));
        return;
      }
      const destination = section === "remotes" ? "connection" : section === "remote" ? "playback" : section;
      const category = '[aria-label="Settings page"]';
      if (await this.execute("return !!document.querySelector(arguments[0])?.getClientRects().length", [category])) {
        await this.select(category, settingsPages[destination as SettingsPage].label);
      } else {
        const target = `[aria-label="Settings pages"] [data-settings-page="${destination}"]`;
        if (await this.execute("return !!document.querySelector('[role=dialog] .settings-back')")) await this.button("All settings", '[role="dialog"]');
        await this.waitFor(`Settings offers ${destination}`, () => this.execute("return !!document.querySelector(arguments[0])", [target]));
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
    await this.execute("arguments[0].focus()", [options[0]]);
    await this.key(keys.enter);
    const closeDeadline = Date.now() + 5_000;
    while (!await this.execute("return !document.querySelector('[role=listbox]') && document.querySelector(arguments[0])?.textContent.trim() === arguments[1]", [selector, label])) {
      assert.ok(Date.now() < closeDeadline, `${selector} closes and displays ${label}`);
      await Bun.sleep(50);
    }
  }
}

export const qualityLabel = (value: string) => value === "auto" ? "Auto (1080p)" : value === "best" ? "Best" : value;

async function settlePortals(ui: UiDriver) {
  await ui.request(`/session/${ui.session()}/execute/async`, {
    script: `const done = arguments[arguments.length - 1];
      requestAnimationFrame(() => requestAnimationFrame(() => Promise.allSettled(
        [...document.querySelectorAll('[data-slot=dialog-content], [data-slot=select-content], [data-slot=popover-content]')]
          .flatMap(portal => portal.getAnimations().map(animation => animation.finished))
      ).then(() => done(null))));`, args: [],
  });
}

export async function assertTheme(ui: UiDriver) {
  const theme = await ui.execute(`
    const root = getComputedStyle(document.documentElement);
    const button = document.querySelector('[data-slot=button].bg-primary');
    const actual = getComputedStyle(button);
    const probe = document.createElement('span');
    probe.style.color = 'var(--primary)';
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    const result = { primary: root.getPropertyValue('--primary').trim(), background: root.getPropertyValue('--background').trim(),
      actual: actual.backgroundColor, expected, display: actual.display, radius: actual.borderRadius, font: getComputedStyle(document.body).fontFamily };
    return result;
  `);
  assert.ok(theme?.primary && theme?.background, "Generated shadcn theme variables are present");
  assert.equal(theme.actual, theme.expected, "Tailwind bg-primary uses the generated theme");
  assert.ok(["flex", "inline-flex"].includes(theme.display), "Generated button layout utilities are compiled");
  assert.ok(parseFloat(theme.radius) > 0, "Generated radius utilities are compiled");
  assert.ok(theme.font.includes("Inter Tight Variable"), "The Clock font is bundled");
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
      // Checkboxes, switches and radios are hit through their label.
      small: [...document.querySelectorAll('button:not(:disabled), input:not(:disabled), [data-slot=slider]')].filter(visible)
        .filter(element => !element.matches('[role=checkbox], [role=switch], [role=radio]') || ![...(element.labels ?? [])].some(label => label.getBoundingClientRect().height >= 43.5)).map(element => {
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
    await request(`/session/${session}/execute/async`, {
      script: "const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(() => document.fonts.ready.then(() => done(null))))", args: [],
    });
    await assertResponsive(ui, "Phone pairing");
    const theme = await assertTheme(ui);
    await ui.type("#pairing-code", code);
    await until("HTTP pairing form enables Connect for a complete code", async () => await ui.execute("return document.querySelector('#pairing-code')?.value.length === 6 && !document.querySelector('.pair-form button')?.disabled"));
    await ui.click(".pair-form button[type=submit], .pair-form button:not([type])");
    await until("real HTTP remote pairs and receives current playback", async () => await ui.execute("return document.querySelector('[data-app-status] [role=status]')?.textContent") === "Connected");
    await assertResponsive(ui, "Phone queue");
    return { ui, theme, close, refresh: () => request(`/session/${session}/refresh`, {}),
      minimize: () => request(`/session/${session}/window/minimize`, {}),
      restore: () => request(`/session/${session}/window/rect`, { x: 1000, y: 0, width: Math.round(390 * scale), height: 900 }),
      screenshot: async (name: string) => { const png = await request(`/session/${session}/screenshot`); await Bun.write(`${artifacts}/${name}.png`, Buffer.from(png, "base64")); } };
  } catch (error) {
    const diagnostics = await ui.execute("return { alerts: [...document.querySelectorAll('[role=alert]')].map(element => element.textContent), status: document.querySelector('[data-app-status]')?.textContent, codeLength: document.querySelector('#pairing-code')?.value.length, connectDisabled: document.querySelector('.pair-form button')?.disabled, viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio } }").catch(() => null);
    await Bun.write(`${artifacts}/${name}-failure.json`, JSON.stringify(diagnostics, null, 2));
    await ui.execute("document.querySelector('#pairing-code')?.setAttribute('type', 'password')").catch(() => {});
    const png = await request(`/session/${session}/screenshot`).catch(() => null);
    if (png) await Bun.write(`${artifacts}/${name}-failure.png`, Buffer.from(png, "base64"));
    await close();
    throw error;
  }
}
