// Empty Vite fixture. Production settings routes; all settings requests stay in this fixture.
import { mountUpdateShellAudit } from "./update-shell.browser";
import { applyTvNavigation } from "../src/client/navigation";
import { defaultTvAppearance } from "../src/shared/appearance";
import { settingsPages } from "../src/shared/settings-pages";
import { avoidRadioPlaylistId } from "../src/shared/radio";
import type { SoundView } from "../src/client/api/settings";
import type { SoundState } from "../src/shared/sound";
import type { DisplayState } from "../src/shared/display";

const wait = () => new Promise(resolve => setTimeout(resolve, 250));
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const urls = ["https://living-room.local", "http://living-room.local", "https://192.168.1.25"];

export async function mountSettingsAudit() {
  const audit = await mountUpdateShellAudit();
  const uiFetch = window.fetch;
  const now = Date.now();
  const responses: Record<string, unknown> = {
    "/api/settings/origin-domain": { domain: "living-room.local", suggested: "living-room.local" },
    "/api/settings/http": { enabled: true },
    "/api/settings/live-relay": { relay: null, source: "none" },
    "/api/settings/live-relay/local": { enabled: false, status: "off", error: null, relay: null },
    "/api/settings/streamingcommunity": { origin: "https://streamingcommunity.example" },
    "/api/settings/airplay": { enabled: false, status: "off", error: null, name: "Living room", code: "1234", sender: null },
    "/api/settings/startup": { enabled: true, fullscreenAtLaunch: true, fullscreenNow: true, applies: "next-session" },
    "/api/hidden": { rules: [{ id: "hidden-1", kind: "word", label: "Trailers", value: "Trailers" }] },
    "/api/sound": { outputs: [{ id: "hdmi", name: "TV speakers", state: "IDLE", availability: "available", muted: false, volume: 50 }], defaultOutput: "hdmi", profiles: [], test: null, canTest: true, audioDelay: 0, routing: { selectedOutput: "hdmi", observedOutput: "hdmi", volume: 50, muted: false, error: null } },
    "/api/bluetooth": { adapter: "available", devices: [{ address: "00:11:22:33:44:55", name: "Kitchen speaker", paired: true, trusted: true, connected: false }], operation: null },
    "/api/display": { outputs: [{ id: "hdmi", name: "Living room TV", connected: true, width: 3840, height: 2160, x: 0, y: 0, refresh: 60 }], saved: "hdmi", current: "hdmi", notice: null, preview: null },
    "/api/iptv/sources": { sources: [{ id: "guide", name: "Public television", channelCount: 12, programCount: 148, hasGuide: true, url: "https://example.com/live.m3u", updatedAt: now, error: null }] },
    "/api/radio/sources": { sources: [{ id: avoidRadioPlaylistId, name: "avoid radio", stationCount: 24, updatedAt: now, error: null }, { id: "jazz", name: "Jazz stations", url: "https://example.com/jazz.m3u", stationCount: 8, updatedAt: now, error: null }] },
  };
  let codeFailed = false, codeReads = 0;
  window.fetch = async (input, init) => {
    const path = new URL(String(input), location.href).pathname;
    if (path === "/api/devices/pairing-code") {
      codeReads++;
      return codeFailed ? Response.json({ error: "Couldn't load the code." }, { status: 503 }) : Response.json({ code: codeReads === 1 ? "123456" : "654321" });
    }
    if (path in responses) return Response.json(await responses[path]);
    return uiFetch(input, init);
  };
  const hardware = () => audit.updateSession(gate => ({ ...gate,
    details: { ...gate.details!, urls, lanError: null, systemAudio: true, airplay: "available", tvPresentation: true, tvModeChangeable: true, tvAppliance: true },
    state: { ...gate.state!, appearance: defaultTvAppearance },
  }));
  await hardware();
  return { ...audit,
    async go(...args: Parameters<typeof audit.go>) { const result = await audit.go(...args); await hardware(); return result; },
    failCode(value: boolean) { codeFailed = value; },
    codeReads: () => codeReads,
    respond(path: string, value: unknown) { responses[path] = value; },
  };
}

export async function runSoundTestFocusRegression() {
  const audit = await mountSettingsAudit();
  try {
    await audit.go("/settings/couch/sound");
    const sound = audit.client.getQueryData<SoundView>(["sound"])!;
    const active = { ...sound, canTest: false, test: { id: "local-test", output: "hdmi", observedOutput: "hdmi", status: "playing", endsAt: Date.now() + 3000, message: null } };
    let finish!: (value: unknown) => void;
    audit.respond("/api/sound/test", new Promise(resolve => { finish = resolve; }));
    const start = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Test TV speakers")!;
    start.focus(); await audit.click("Test TV speakers");
    assert(document.activeElement === start, "Sending a sound test loses keyboard focus");
    audit.respond("/api/sound", active); finish(active); await wait();
    assert(document.activeElement?.textContent === "Stop", "Starting a sound test loses focus instead of keeping it on Stop");
    audit.respond("/api/sound/stop", sound); audit.respond("/api/sound", sound);
    await audit.click("Stop");
    assert(document.activeElement === start && start.textContent === "Test TV speakers", "Stopping a sound test does not return to its output");

    const other = document.querySelector<HTMLElement>('[data-settings-page="sound"]')!;
    other.focus();
    audit.respond("/api/sound", { ...active, test: { ...active.test, id: "remote-test" } });
    await audit.client.refetchQueries({ queryKey: ["sound"] }); await wait();
    assert(document.activeElement === other, "A test started elsewhere steals focus");
    audit.respond("/api/sound", sound);
    await audit.client.refetchQueries({ queryKey: ["sound"] }); await wait();
    start.focus();
    audit.respond("/api/sound/test", new Promise(resolve => { finish = resolve; }));
    await audit.click("Test TV speakers"); other.focus();
    audit.respond("/api/sound", active); finish(active); await wait();
    assert(document.activeElement === other, "A delayed test moves focus after the user left its controls");
    return "Passed: Test/Stop preserves its output's focus, while remote tests and delayed responses do not steal focus.";
  } finally { audit.close(); }
}

export async function runSettingsPreviewRegression() {
  const audit = await mountSettingsAudit();
  try {
    await audit.go("/settings/couch/tv");
    const display = audit.client.getQueryData<DisplayState>(["display"])!;
    const preview = { token: "screen-preview", expiresAt: Date.now() + 20_000 };
    audit.respond("/api/display/preview", { ...display, preview });
    audit.respond("/api/display", { ...display, preview });
    await audit.click("Try Living room TV");
    await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, appearance: { size: 1.15, confirmedSize: 1, preview: { id: "size-preview", expiresAt: preview.expiresAt } } } }));
    const previewStatus = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="status"]')].find(status => status.textContent?.includes(label));
    const screen = previewStatus("Keep this screen?");
    const size = previewStatus("Keep this size?");
    assert(screen?.textContent?.includes("Reverting in") && size?.textContent?.includes("Reverting in"), "Screen and text-size previews do not announce their confirmation and countdown");
    const before = [screen!.textContent, size!.textContent];
    await new Promise(resolve => setTimeout(resolve, 1_200));
    assert(screen!.textContent !== before[0] && size!.textContent !== before[1], "Preview countdown announcements stop updating");
    assert(screen!.querySelectorAll("button").length === 2 && size!.querySelectorAll("button").length === 2, "A preview lost its Keep/Revert actions");
    return "Passed: screen and text-size confirmations expose live countdowns and retain Keep/Revert actions.";
  } finally { audit.close(); }
}

export async function runSettingsFeedbackRegression() {
  const audit = await mountSettingsAudit();
  const announces = (text: string) => [...document.querySelectorAll('[role="status"]')].some(status => status.textContent?.includes(text));
  try {
    await audit.go("/settings/couch/sound");
    const sound = audit.client.getQueryData<SoundView>(["sound"])!;
    const test = { id: "test", output: "hdmi", observedOutput: "hdmi", endsAt: Date.now() + 3000, message: null };
    const updateSound = async (changes: Partial<SoundState>) => {
      audit.respond("/api/sound", { ...sound, ...changes });
      await audit.client.refetchQueries({ queryKey: ["sound"] }); await wait();
    };
    await updateSound({ canTest: false, test: { ...test, status: "starting" } });
    assert(announces("Starting…"), "Starting a sound test lost its live feedback");
    await updateSound({ canTest: false, test: { ...test, status: "playing" } });
    assert(announces("Playing tone…"), "Playing a sound test lost its live feedback");
    const finished = { ...test, status: "finished" as const, message: "Sound test ended." };
    await updateSound({ test: finished });
    assert(announces("Sound test ended."), "A completed sound test lost its result");
    await updateSound({ canTest: false, test: finished });
    assert(announces("Stop playback to test sound.") && !document.body.textContent?.includes("Sound test ended."), "A stale test result hides why testing is unavailable");
    assert([...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Test TV speakers")?.disabled, "Sound test is enabled during playback");

    await audit.go("/settings/couch/sources");
    audit.respond("/api/settings/airplay", { enabled: true, status: "receiving", error: null, name: "Living room", code: "1234", sender: "Phone" });
    await audit.client.refetchQueries({ queryKey: ["airplay"] }); await wait();
    assert(announces("Phone is sending sound."), "AirPlay sender changes lost their live feedback");

    await audit.go("/settings/couch/devices");
    audit.respond("/api/settings/live-relay", { source: "environment", relay: { urls: "turn:relay.example:3478", username: "fixture", credential: "fixture" } });
    await audit.client.refetchQueries({ queryKey: ["live-relay"] }); await wait();
    assert(announces("Using an external relay from launch settings."), "Active launch relay settings are hidden in a collapsed form");
    audit.respond("/api/settings/live-relay/local", { enabled: true, status: "starting", error: null, relay: null });
    await audit.client.refetchQueries({ queryKey: ["local-relay"] }); await wait();
    assert(announces("Starting the bundled relay…"), "Relay startup lost its live feedback");
    return "Passed: sound test progress and disabled reason, AirPlay sender announcements, visible external relay source and relay startup feedback.";
  } finally { audit.close(); }
}

export async function runPairingDialogRegression() {
  const audit = await mountSettingsAudit();
  try {
    await audit.go("/settings/couch/devices");
    await audit.click("Pair a device");
    const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
    const code = () => dialog()?.querySelector("[data-pairing-code]");
    assert(code()?.textContent === "123 456", "Pairing did not show a readable code");
    assert(dialog()?.querySelectorAll("a").length === 1, "Pairing exposes every address before it is needed");
    assert(!dialog()?.textContent?.includes("Pairing code") && !dialog()?.textContent?.includes("Open on your device"), "Pairing repeats its instructions as headings");
    await audit.click("Other addresses");
    assert(dialog()?.querySelectorAll("a").length === 3 && dialog()?.textContent?.includes("HTTP is unencrypted"), "Alternate addresses lost their connection guidance");
    assert(dialog()!.scrollWidth <= dialog()!.clientWidth, "Pairing overflows horizontally");
    applyTvNavigation("back"); await wait();
    assert(!dialog() && document.activeElement?.textContent === "Pair a device", "Pairing Back did not restore its opener");
    audit.failCode(true);
    await audit.click("Pair a device");
    assert(!code() && dialog()?.textContent?.includes("Couldn't load the code"), "Reopening reused a stale pairing code");
    audit.failCode(false);
    await audit.click("Try again");
    assert(code()?.textContent === "654 321" && audit.codeReads() >= 3, "Pairing retry did not fetch a fresh code");
    await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, devices: [...gate.state!.devices, { id: "new-phone", name: "Phone", online: true, volume: 50, muted: false, sharing: { audio: false, video: false } }] } }));
    assert(!dialog(), "Pairing success left the dialog open");
    assert(document.querySelector('[data-sonner-toast]')?.textContent?.includes("Phone paired"), "Pairing success has no toast");
    return "Passed: readable code, quiet alternate addresses, responsive dialog, fresh codes and retry, remote Back, pairing success and toast.";
  } finally { audit.close(); }
}

export async function runSettingsLayoutAudit() {
  const audit = await mountSettingsAudit();
  const results = [];
  try {
    for (const page of Object.values(settingsPages).filter(page => page.path !== "/settings/device/updates")) {
      await audit.go(page.path);
      const errors = [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent);
      assert(errors.length === 0, `${page.path}: ${errors.join(", ")}`);
      assert(document.documentElement.scrollWidth <= innerWidth, `${page.path} overflows horizontally`);
      assert(document.querySelector("[data-settings-content]"), `${page.path} has no settings content`);
      results.push(page.path);
    }
    return results;
  } finally { audit.close(); }
}

export async function runSettingsActionsRegression() {
  const audit = await mountSettingsAudit();
  const openMenu = async (name: string) => {
    const trigger = document.querySelector<HTMLButtonElement>(`button[aria-label="Options for ${name}"]`)!;
    assert(trigger, `No options for ${name}`);
    trigger.focus();
    // Source forms deliberately reject phone-remote commands; their local keyboard still opens the menu.
    if (trigger.closest("[data-tv-local-only]")) trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    else applyTvNavigation("select");
    await wait();
    assert(document.querySelector('[role="menu"]'), `Options for ${name} did not open`);
    if (trigger.closest("[data-tv-local-only]")) {
      assert(document.querySelector('[role="menu"][data-tv-local-only]'), "A source menu lost its local-only boundary in its portal");
      applyTvNavigation("select"); await wait();
      assert(document.querySelector('[role="menu"]') && !document.querySelector('[role="alertdialog"]'), "A phone remote acted on a local-only source menu");
    }
    return trigger;
  };
  const choose = async (label: string) => {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === label);
    assert(item, `No menu item ${label}`); item!.click(); await wait();
  };
  try {
    for (const [path, name, action] of [
      ["/settings/couch/devices", "Living room TV", "Forget"],
      ["/settings/couch/sound", "Kitchen speaker", "Forget"],
      ["/settings/couch/sources/radio", "Jazz stations", "Remove"],
      ["/settings/couch/sources/live-tv", "Public television", "Remove"],
    ]) {
      await audit.go(path!);
      const trigger = await openMenu(name!);
      await choose(action!);
      assert(document.activeElement?.closest('[role="alertdialog"]'), `${name}: confirmation did not take focus`);
      await audit.click("Cancel"); await wait();
      assert(document.activeElement === trigger, `${name}: Cancel lost the row menu`);
    }
    await openMenu("Public television"); await choose("Edit");
    assert(document.activeElement?.id === "guide-source-name", "Edit did not focus and reveal the source form");
    assert((document.activeElement as HTMLInputElement).value === "Public television", "Edit did not populate the source name");
    await audit.click("Cancel");
    assert(document.querySelector('[data-settings-content]')?.textContent?.includes("Add source"), "Cancel did not leave source editing");
    return "Passed: settings menus, destructive confirmations and focus restoration, Live TV Edit focus and Cancel.";
  } finally { audit.close(); }
}
