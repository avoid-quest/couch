import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { UiDriver } from "./ui";

// This tests navigation routing against old/new DOM shapes, not native input.
function fixture(grouped: boolean) {
  const window = new Window();
  const document = window.document;
  const clicks: string[] = [], waits: string[] = [];
  const wire = "element-6066-11e4-a52e-4f735466cecf";
  const groups: Record<string, string[]> = { profile: ["playback"], device: ["appearance", "connection", "remote"], tv: ["general", "sources", "updates", "advanced", "remotes", "tv-appearance"] };
  const tabs = (ids: string[]) => ids.map(id => `<button role="tab" id="settings-trigger-${id}" aria-selected="false">${id}</button>`).join("");
  const landing = () => { document.body.innerHTML = `<div role="dialog"><div aria-label="Settings sections">${Object.keys(groups).map(id => `<button id="group-${id}" data-settings-group="${id}">${id}</button>`).join("")}</div></div>`; };
  const group = (id: string) => { document.body.innerHTML = `<div role="dialog"><button id="back">All settings</button><div aria-label="Settings sections">${tabs(groups[id]!)}</div></div>`; };
  if (grouped) landing();
  else document.body.innerHTML = `<div role="dialog"><div aria-label="Settings sections">${tabs(["general", "playback", "remote", "sources", "connection", "appearance", "updates", "advanced"])}</div></div>`;
  document.addEventListener("click", event => {
    const target = event.target as Window["document"]["body"];
    if (target.dataset.settingsGroup) group(target.dataset.settingsGroup);
    else if (target.id === "back") landing();
    else if (target.getAttribute("role") === "tab") {
      for (const tab of document.querySelectorAll('[role="tab"]')) tab.setAttribute("aria-selected", String(tab === target));
    }
  });
  const ui = new UiDriver(async (path, body: any) => {
    if (path.endsWith("/element")) return { [wire]: document.querySelector(body.value)?.id };
    if (path.endsWith("/execute/sync")) {
      expect(body.script).not.toMatch(/\.click\(/);
      const result = new Function("document", "args", `return (function () { ${body.script} }).apply(null, args)`)(document, body.args);
      return Array.isArray(result) ? result.map(value => value instanceof window.HTMLElement ? { [wire]: value.id } : value) : result;
    }
    throw new Error(`Unexpected WebDriver call ${path}`);
  }, () => "test");
  ui.clickElement = async (id, selector) => { const target = selector ? document.querySelector<HTMLElement>(selector)! : document.getElementById(id)!; clicks.push(target.id); target.click(); };
  ui.waitFor = async (description, predicate) => { waits.push(description); expect(await predicate()).toBe(true); };
  return { ui, clicks, waits, selected: () => document.querySelector('[aria-selected="true"]')?.id, close: () => window.happyDOM.abort() };
}

test("new Settings reaches Updates from its landing and crosses ownership groups through All settings", async () => {
  const f = fixture(true);
  try {
    await f.ui.settingsSection("updates");
    expect(f.clicks).toEqual(["group-tv", "settings-trigger-updates"]);
    await f.ui.settingsSection("general");
    expect(f.clicks.at(-1)).toBe("settings-trigger-general");
    await f.ui.settingsSection("connection");
    expect(f.clicks.slice(-3)).toEqual(["back", "group-device", "settings-trigger-connection"]);
    await f.ui.settingsSection("remotes");
    expect(f.clicks.slice(-3)).toEqual(["back", "group-tv", "settings-trigger-remotes"]);
    expect(f.selected()).toBe("settings-trigger-remotes");
    expect(f.waits).toContain("Settings selects updates");
  } finally { await f.close(); }
});

test("old A keeps flat Settings and maps moved controls to their original sections", async () => {
  const f = fixture(false);
  try {
    for (const section of ["updates", "general", "remote", "playback", "tv-appearance", "remotes"]) await f.ui.settingsSection(section);
    expect(f.clicks).toEqual(["updates", "general", "remote", "playback", "appearance", "connection"].map(id => `settings-trigger-${id}`));
    expect(f.selected()).toBe("settings-trigger-connection");
  } finally { await f.close(); }
});
