import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { deviceId } from "../src/client/session/device-id";

const here = deviceId();
let devices = [{ id: here, name: "Phone", online: true, volume: 50, muted: false }];
const mac = { id: "mac", name: "Mac", online: true, volume: 50, muted: false, sharing: { audio: true, video: true } };
// Bun shares module mocks between test files, so this one provides both session hooks.
const gate = () => ({ state: { devices, controlling: here } });
mock.module("../src/client/session/session-context", () => ({ useOptionalSessionGate: gate, useSessionGate: gate }));
const { holdDelay, startHold } = await import("../src/client/hold");
const { MediaRow } = await import("../src/client/components/MediaRow");
const { MediaTile } = await import("../src/client/components/MediaTile");

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

test("a press released before the hold acts once on release; one held opens the menu once and doesn't act", async () => {
  expect(holdDelay).toBe(500);
  let held = 0;
  const short = startHold(() => held++, 40);
  await wait(10);
  expect(short.release()).toBe(true);
  await wait(60);
  expect(held).toBe(0);
  const long = startHold(() => held++, 40);
  await wait(60);
  expect(held).toBe(1);
  expect(long.release()).toBe(false);
  await wait(60);
  expect(held).toBe(1);
});

// The visible "…" buttons; a row whose page holds its verbs keeps only a hidden anchor, named the same.
const options = (html: string) => html.match(/<button[^>]*data-row-options[^>]*>/g)?.map(button => /aria-label="([^"]*)"/.exec(button)?.[1]) ?? [];
const row = (props: Partial<Parameters<typeof MediaRow>[0]>) => renderToStaticMarkup(<ul><MediaRow title="Montalbano" primary={{ label: "Open", onClick: () => {} }} {...props} /></ul>);
const tile = (props: Partial<Parameters<typeof MediaTile>[0]>) => renderToStaticMarkup(<MediaTile title="Radio 3" shape="square" onClick={() => {}} {...props} />);

test("a row or tile with verbs shows one \"…\", and its primary target is marked for a held OK", () => {
  const queue = [{ label: "Queue", run: () => {} }];
  expect(options(row({ menu: queue }))).toEqual(["Options for Montalbano"]);
  expect(row({ menu: queue })).toContain("data-item-menu");
  expect(options(tile({ menu: queue }))).toEqual(["Options for Radio 3"]);
  expect(tile({ menu: queue })).toContain("data-item-menu");
});

test("no \"…\" without verbs, or for Play on alone with no other device", () => {
  const playOn = [{ label: "Play on", playOn: () => {} }];
  for (const html of [row({}), tile({}), row({ menu: playOn }), tile({ menu: playOn })]) {
    expect(options(html)).toEqual([]);
    expect(html).not.toContain("data-item-menu");
  }
  devices = [...devices, mac];
  try {
    expect(options(row({ menu: playOn }))).toHaveLength(1);
    expect(options(tile({ menu: playOn }))).toHaveLength(1);
  } finally { devices = devices.filter(device => device !== mac); }
});
