import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useEffect, useState } from "react";
import type { Root } from "react-dom/client";
import { Link } from "react-router";
import { CouchRouter, readSearchState, searchLocation, usePageRoute } from "./routes";
import { pagePaths, sectionForPath } from "../shared/page-paths";
import { settingsPages, settingsPageForPath, settingsPagePath } from "../shared/settings-pages";

let root: Root, window: Window;
const originals = new Map<string, PropertyDescriptor | undefined>();
let mounts = 0, unmounts = 0;
const flush = () => act(async () => { await Bun.sleep(20); });
function SessionShell() {
  const route = usePageRoute();
  const [playbackId] = useState("existing-playback");
  useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
  return <><output>{route.section}:{playbackId}</output><div data-query={route.searchState.query} data-source={route.searchState.source} />
    {Object.keys(pagePaths).map(section => <Link key={section} to={route.sectionUrl(section)}>{section}</Link>)}
    <button onClick={() => route.changeSearch({ query: "moon & stars", source: "TV folders" })}>Submit search</button>
    <Link to={settingsPages.sound.path}>Sound settings</Link>
    <Link to={settingsPages["source-jellyfin"].path}>Jellyfin settings</Link>
    <button onClick={() => route.changeSettingsSection("playback")}>Playback settings</button>
    <button onClick={() => route.changeSettingsSection(null)}>All settings</button>
    <div data-settings-section={route.settingsSection ?? "index"} />
    <button onClick={route.back}>Back</button></>;
}
async function render(native = false) { await act(async () => root.render(<CouchRouter native={native}><SessionShell /></CouchRouter>)); await flush(); }
async function click(label: string) { await act(async () => [...document.querySelectorAll<HTMLElement>("a,button")].find(node => node.textContent === label)!.click()); await flush(); }
beforeEach(async () => {
  mounts = unmounts = 0;
  window = new Window({ url: "http://localhost/search?q=initial&source=Radio" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "PopStateEvent", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key) });
  }
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount()); await window.happyDOM.close();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("browser direct links and page navigation keep one session and preserve search in real links", async () => {
  await render();
  expect(document.querySelector("output")?.textContent).toBe("Search:existing-playback");
  expect(document.querySelector("[data-query]")?.getAttribute("data-query")).toBe("initial");
  await click("Submit search");
  expect(window.location.pathname + window.location.search).toBe("/search?q=moon+%26+stars&source=TV+folders");
  for (const page of ["Saved", "Queue", "Settings", "Home"]) { await click(page); expect(window.location.pathname).toBe(page === "Settings" ? "/settings/playback" : pagePaths[page]); }
  expect(document.querySelector<HTMLAnchorElement>('a[href^="/search"]')?.getAttribute("href")).toBe("/search?q=moon+%26+stars&source=TV+folders");
  await click("Search");
  expect(document.querySelector("[data-query]")?.getAttribute("data-source")).toBe("TV folders");
  expect(mounts).toBe(1); expect(unmounts).toBe(0);
});

test("browser Back and Forward restore pages and search values without remounting", async () => {
  await render(); await click("Submit search"); await click("Saved");
  await act(async () => window.history.back()); await flush();
  expect(document.querySelector("output")?.textContent).toBe("Search:existing-playback");
  expect(document.querySelector("[data-query]")?.getAttribute("data-query")).toBe("moon & stars");
  await act(async () => window.history.back()); await flush();
  expect(document.querySelector("[data-query]")?.getAttribute("data-query")).toBe("initial");
  await act(async () => window.history.forward()); await flush();
  expect(document.querySelector("[data-query]")?.getAttribute("data-source")).toBe("TV folders");
  expect(mounts).toBe(1); expect(unmounts).toBe(0);
});

test("native hash direct links, navigation and remote Back stay in the webview document", async () => {
  window.history.replaceState(null, "", "/index.html#/settings");
  await render(true);
  expect(document.querySelector("output")?.textContent).toBe("Settings:existing-playback");
  expect(window.location.hash).toBe("#/settings/playback");
  await click("Search"); await click("Submit search"); await click("Queue");
  expect(window.location.pathname).toBe("/index.html"); expect(window.location.hash).toBe("#/up-next");
  await click("Back");
  expect(window.location.hash).toBe("#/search?q=moon+%26+stars&source=TV+folders");
  expect(document.querySelector("[data-query]")?.getAttribute("data-query")).toBe("moon & stars");
  expect(mounts).toBe(1); expect(unmounts).toBe(0);
});

test("all pages map to known paths and malformed search filters use truthful defaults", () => {
  for (const [section, path] of Object.entries(pagePaths)) expect(sectionForPath(path)).toBe(section);
  expect(sectionForPath("/search/")).toBe("Search");
  expect(sectionForPath("/api/settings")).toBeUndefined();
  expect(readSearchState("?q=a%26b&source=Unknown")).toEqual({ query: "a&b", source: "All" });
  expect(searchLocation({ query: "", source: "All" })).toBe("/search");
});


test("settings direct links and browser history keep the session mounted", async () => {
  window.history.replaceState(null, "", "/settings/bluetooth");
  await render();
  expect(document.querySelector("output")?.textContent).toBe("Settings:existing-playback");
  expect(document.querySelector("[data-settings-section]")?.getAttribute("data-settings-section")).toBe("bluetooth");
  expect(document.title).toBe("Bluetooth · Settings · Couch");
  await click("Sound settings");
  expect(window.location.pathname).toBe("/settings/sound");
  await click("Playback settings");
  expect(window.location.pathname).toBe("/settings/playback");
  await act(async () => window.history.back()); await flush();
  expect(document.querySelector("[data-settings-section]")?.getAttribute("data-settings-section")).toBe("sound");
  await act(async () => window.history.forward()); await flush();
  expect(document.querySelector("[data-settings-section]")?.getAttribute("data-settings-section")).toBe("playback");
  await click("All settings");
  expect(window.location.pathname).toBe("/settings/playback");
  expect(document.title).toBe("Playback · Settings · Couch");
  expect(mounts).toBe(1); expect(unmounts).toBe(0);
});

test("native settings links and remote Back retain the webview document", async () => {
  window.history.replaceState(null, "", "/index.html#/settings/tv");
  await render(true);
  expect(document.querySelector("[data-settings-section]")?.getAttribute("data-settings-section")).toBe("general");
  await click("Sound settings");
  expect(window.location.hash).toBe("#/settings/sound");
  await click("Playback settings");
  await click("Back");
  expect(window.location.hash).toBe("#/settings/sound");
  expect(window.location.pathname).toBe("/index.html");
  expect(mounts).toBe(1); expect(unmounts).toBe(0);
});

test("settings routes only accept defined pages", () => {
  for (const [page, { path }] of Object.entries(settingsPages)) {
    expect(sectionForPath(path)).toBe("Settings");
    expect(settingsPageForPath(path + "/") as string).toBe(page);
  }
  expect(settingsPagePath(null)).toBe("/settings");
  expect(settingsPageForPath("/settings/not-a-page")).toBeNull();
  expect(sectionForPath("/settings/not-a-page")).toBeUndefined();
  expect(sectionForPath("/api/settings/sound")).toBeUndefined();
});


test("source settings direct links retain their page and browser history", async () => {
  window.history.replaceState(null, "", "/settings/sources/folders");
  await render();
  expect(document.querySelector("output")?.textContent).toBe("Settings:existing-playback");
  expect(document.querySelector("[data-settings-section]")?.getAttribute("data-settings-section")).toBe("source-folders");
  expect(document.title).toBe("TV folders · Settings · Couch");
  await click("Jellyfin settings");
  expect(window.location.pathname).toBe("/settings/sources/jellyfin");
  await click("Back");
  expect(window.location.pathname).toBe("/settings/sources/folders");
  expect(mounts).toBe(1); expect(unmounts).toBe(0);
});

test("Settings entry selects Playback and Back skips the index", async () => {
  await render();
  await click("Settings");
  expect(window.location.pathname).toBe("/settings/playback");
  expect(document.querySelector("[data-settings-section]")?.getAttribute("data-settings-section")).toBe("playback");
  await click("Back");
  expect(window.location.pathname).toBe("/search");
  expect(mounts).toBe(1);
});
