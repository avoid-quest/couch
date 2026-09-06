import { expect, test } from "bun:test";
import { assertGuideStart } from "./iptv-start";

type Request = Parameters<typeof assertGuideStart>[0][number];
const probe: Request = { path: "/blue/live.m3u8", native: false, at: 100, servedAt: 110 };
const manifest = (at: number, newest: number): Request => ({ path: "/blue/live.m3u8", native: true, at, sequences: [newest - 2, newest - 1, newest] });
const segment = (at: number, sequence: number): Request => ({ path: `/blue/segments/${sequence}.ts`, native: true, at, sequence });

test("live startup accepts a single complete new trace including later fresh segments", () => {
  const requests = [probe, manifest(111, 5), segment(112, 5), segment(113, 6)];
  expect(assertGuideStart(requests)).toEqual({ probe, manifest: requests[1], segments: requests.slice(2) });
});

test("an old matching pair cannot hide a second native manifest and older new-load segment", () => {
  const requests = [probe, manifest(111, 5), segment(112, 5), manifest(114, 6), segment(115, 4)];
  expect(() => assertGuideStart(requests)).toThrow("exactly one blue manifest");
});

test("live startup retains and rejects pre-probe or pre-manifest requests and later older segments", () => {
  expect(() => assertGuideStart([manifest(99, 5), probe, segment(112, 5)])).toThrow("follows the fresh host probe");
  expect(() => assertGuideStart([segment(99, 4), probe, manifest(111, 5), segment(112, 5)])).toThrow("cannot precede");
  expect(() => assertGuideStart([probe, manifest(111, 5), segment(112, 5), segment(113, 4)])).toThrow("No requested segment");
});
