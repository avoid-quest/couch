import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { WatchingProfile as Profile } from "../shared/library";
import { personalProfileName, profileDisplayName } from "./profile-name";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const legacy = { id: "household", name: "Household" }, alex = { id: "alex", name: "Alex" };
let profiles: Profile[], fail = false;
const mutations: { path: string; body: unknown }[] = [];
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === name || node.textContent?.trim() === name)!;
async function render(profile: Profile = legacy, playing = false, version = 0) {
  const { WatchingProfile } = await import("./WatchingProfile");
  await act(async () => root.render(<WatchingProfile origin="http://localhost" token="paired" connected profile={profile} playing={playing} version={version} caption />));
}
const click = (name: string) => act(async () => button(name).click());
async function type(selector: string, value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  profiles = [legacy, alex]; fail = false; mutations.length = 0;
  window = new Window({ url: "http://localhost" });
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "ResizeObserver", "CustomEvent", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "IS_REACT_ACT_ENVIRONMENT"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? window : Reflect.get(window, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: typeof value === "function" && /^[a-z]/.test(key) ? value.bind(window) : value });
  }
  request = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
    if (init?.method === "POST") {
      mutations.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init.body)) });
      if (fail) return Response.json({ error: "This profile was renamed on another remote. Review its current name." }, { status: 409 });
      return Response.json({ ok: true });
    }
    return Response.json({ profiles });
  }) as typeof fetch);
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount()); request.mockRestore(); await window.happyDOM.abort();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  originals.clear();
});

test("only the legacy placeholder is unnamed; stored personal names remain intact", () => {
  expect(personalProfileName(legacy)).toBeNull();
  expect(profileDisplayName(undefined)).toBe("Your profile");
  expect(personalProfileName({ ...legacy, name: "Francesco" })).toBe("Francesco");
  expect(personalProfileName(alex)).toBe("Alex");
  expect(personalProfileName({ id: "chosen", name: "Household" })).toBe("Household");
});

test("name entry renames the existing profile during playback without selection, creation or deletion", async () => {
  await render(legacy, true); await click("Set your name");
  expect(document.body.textContent).not.toContain("Household");
  expect(document.body.textContent).not.toContain("Shared default");
  expect(document.body.textContent).toContain("existing history and preferences");
  expect(document.activeElement?.id).toBe("watching-profile-person-name");
  for (const control of document.querySelectorAll<HTMLButtonElement>("button[aria-pressed], [data-action=remove]")) expect(control.disabled).toBe(true);
  await type("#watching-profile-person-name", "  Francesco  "); await click("Save name");
  expect(mutations).toEqual([{ path: "/api/profiles/household/rename", body: { name: "Francesco", expectedName: "Household" } }]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await render({ ...legacy, name: "Francesco" }, true, 1);
  expect(button("Watching profile: Francesco").textContent).toContain("Francesco");
});

test("an existing person can be chosen without claiming or renaming the unnamed profile", async () => {
  await render(); await click("Set your name"); await click("Alex");
  expect(mutations).toEqual([{ path: "/api/profiles/alex/select", body: {} }]);
  await render(alex); await click("Watching profile: Alex");
  expect(document.querySelector("#watching-profile-person-name")).toBeNull();
  expect(document.body.textContent).not.toContain("Household");
});

test("name entry keeps its draft and focus through live refresh and explains a conflicting rename", async () => {
  await render(); await click("Set your name"); await type("#watching-profile-person-name", "Francesco");
  const input = document.querySelector<HTMLInputElement>("#watching-profile-person-name")!;
  input.focus(); await render(legacy, false, 1);
  expect(document.querySelector("#watching-profile-person-name")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("Francesco");
  fail = true; await click("Save name");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(input.value).toBe("Francesco");
  expect(document.body.textContent).toContain("renamed on another remote");
  expect(mutations).toHaveLength(1);
});
