import { expect, test } from "bun:test";
import { isBackground } from "../src/client/useCouchHotkeys";

// Bun has no DOM, so a small element answers `closest` for the tag, attribute and :not() selectors the rule uses.
type Fake = { tag: string; attributes: Record<string, string>; parent?: Fake };
const attributes = (selector: string) => [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].map(([, name, value]) => ({ name: name!, value }));
const matches = (element: Fake, selector: string) => selector.split(",").some(part => {
  const [, tag, rest] = part.trim().match(/^([a-z]*)(.*)$/)!;
  const not = rest!.match(/:not\((.*)\)$/);
  const has = ({ name, value }: { name: string; value?: string }) => name in element.attributes && (value === undefined || element.attributes[name] === value);
  return (!tag || tag === element.tag) && attributes(not ? rest!.slice(0, not.index) : rest!).every(has) && !(not && attributes(not[1]!).every(has));
});
const element = (tag: string, attributes: Record<string, string> = {}, parent?: Fake) => {
  const fake: Fake = { tag, attributes, parent };
  return Object.assign(fake, { closest: (selector: string) => { for (let at: Fake | undefined = fake; at; at = at.parent) if (matches(at, selector)) return at; return null; } }) as unknown as Element & Fake;
};

const player = element("section", { "aria-label": "Player" });
const surface = element("div", { "data-player-surface": "", tabindex: "-1", role: "group", "aria-label": "Player: The Night Train" }, player);
const band = element("div", { "data-player-band": "shown" }, player);

test("The player's focused surface leaves Space and the arrows to the shortcuts", () => {
  expect(isBackground(surface)).toBe(true);
});

test("A focused band button, or anything inside it, keeps its keys", () => {
  const pause = element("button", { "aria-label": "Pause" }, band);
  expect(isBackground(pause)).toBe(false);
  expect(isBackground(element("svg", {}, pause))).toBe(false);
  expect(isBackground(element("span", { role: "slider", tabindex: "0", "aria-label": "Playback position" }, band))).toBe(false);
  // A roving tabindex takes a control out of the tab order without making it background.
  expect(isBackground(element("button", { tabindex: "-1" }, band))).toBe(false);
  expect(isBackground(element("video", { controls: "" }, player))).toBe(false);
  expect(isBackground(element("audio", { controls: "" }, player))).toBe(false);
});

test("Nothing focused is background, and a tab stop is a control", () => {
  expect(isBackground(null)).toBe(true);
  expect(isBackground(element("body"))).toBe(true);
  expect(isBackground(element("div", { tabindex: "0" }))).toBe(false);
});
