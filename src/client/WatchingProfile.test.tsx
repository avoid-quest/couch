import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { WatchingProfile as Profile } from "../shared/library";
import { storedProfileName, personDisplayName } from "./profile-name";

let root: Root, window: Window, request: ReturnType<typeof spyOn>;
const originals = new Map<string, PropertyDescriptor | undefined>();
const legacy = { id: "household", name: "Household" }, alex = { id: "alex", name: "Alex" };
let profiles: Profile[], fail = false;
const mutations: { path: string; body: unknown }[] = [];
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === name || node.textContent?.trim() === name)!;
async function render(profile: Profile = legacy, playing = false, version = 0, connected = true) {
  const { WatchingProfile } = await import("./WatchingProfile");
  await act(async () => root.render(<WatchingProfile origin="http://localhost" token="paired" connected={connected} profile={profile} playing={playing} version={version} />));
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

test("legacy labels never establish a person's name", () => {
  expect(storedProfileName(legacy)).toBeNull();
  for (const profile of [undefined, legacy, alex, { ...legacy, name: "MBP" }]) expect(personDisplayName(profile)).toBe("Your name");
  expect(personDisplayName({ ...alex, personName: "Alex" })).toBe("Alex");
});

test("naming during playback changes only the existing record through the explicit person endpoint", async () => {
  const mbp = { ...legacy, name: "MBP" };
  profiles = [mbp, alex];
  await render(mbp, true); await click("Your name");
  expect(document.body.textContent).not.toContain("Profiles");
  expect(document.body.textContent).not.toContain("Household");
  expect(document.activeElement?.id).toBe("watching-person-name");
  expect(document.querySelector<HTMLInputElement>("#watching-person-name")!.value).toBe("");
  expect(document.querySelector("details")?.open).toBe(false);
  for (const control of document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")) expect(control.disabled).toBe(true);
  await type("#watching-person-name", "  Francesco  "); await click("Save name");
  expect(mutations).toEqual([{ path: "/api/profiles/household/person-name", body: { name: "Francesco", expectedName: "MBP" } }]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const named = { ...mbp, name: "Francesco", personName: "Francesco" };
  await render(named, true, 1);
  expect(button("Your name: Francesco").textContent).toBe("Francesco");
  await render(named, true, 1, false);
  expect(button("Your name: Francesco").textContent).toBe("Francesco");
  expect(button("Your name: Francesco").disabled).toBe(true);
});

test("existing histories remain accessible without creation, deletion or a duplicate manager", async () => {
  await render(); await click("Your name");
  expect(document.querySelector("details summary")?.textContent).toBe("Existing histories");
  expect(document.querySelector("details")?.open).toBe(false);
  expect(document.body.textContent).toContain("Original history");
  expect(document.body.textContent).not.toContain("New profile");
  expect(document.body.textContent).not.toContain("Remove");
  await click("Alex");
  expect(mutations).toEqual([{ path: "/api/profiles/alex/select", body: {} }]);
  profiles = [legacy];
  await click("Your name");
  expect(document.querySelector("details")).toBeNull();
});

test("name draft and focus survive live updates and server conflicts", async () => {
  await render(); await click("Your name"); await type("#watching-person-name", "Francesco");
  const input = document.querySelector<HTMLInputElement>("#watching-person-name")!;
  input.focus(); await render(legacy, false, 1);
  expect(document.querySelector("#watching-person-name")).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("Francesco");
  fail = true; await click("Save name");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(input.value).toBe("Francesco");
  expect(document.body.textContent).toContain("changed on another remote");
  expect(mutations).toHaveLength(1);
});

test("an active history change cannot apply an old name draft to another history", async () => {
  await render(); await click("Your name"); await type("#watching-person-name", "Francesco");
  await render(alex, false, 1);
  expect(document.querySelector<HTMLInputElement>("#watching-person-name")!.value).toBe("Francesco");
  expect(button("Save name").disabled).toBe(true);
  expect(mutations).toEqual([]);
  await click("Use current name");
  expect(document.querySelector<HTMLInputElement>("#watching-person-name")!.value).toBe("");
  await type("#watching-person-name", "Alex"); await click("Save name");
  expect(mutations).toEqual([{ path: "/api/profiles/alex/person-name", body: { name: "Alex", expectedName: "Alex" } }]);
});
