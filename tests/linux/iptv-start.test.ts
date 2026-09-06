import { expect, test } from "bun:test";
import { assertGuideStartConsistency } from "./iptv-start";

type Request = Parameters<typeof assertGuideStartConsistency>[0][number];
const probe: Request = { path: "/blue/live.m3u8", native: false, at: 100, servedAt: 110 };
const manifest = (at: number, newest: number): Request => ({ path: "/blue/live.m3u8", native: true, at, sequences: [newest - 2, newest - 1, newest] });
const segment = (at: number, sequence: number): Request => ({ path: `/blue/segments/${sequence}.ts`, native: true, at, sequence });

test("live startup accepts a single complete new trace including later fresh segments", () => {
  const requests = [probe, manifest(111, 5), segment(112, 5), segment(113, 6)];
  expect(assertGuideStartConsistency(requests)).toEqual({ probe, manifests: [requests[1]], segments: requests.slice(2) });
});

test("mpv stream sniff and HLS demuxer reopen can advertise the same startup window", () => {
  const requests = [probe, manifest(111, 5), manifest(113, 5), segment(113, 5)];
  expect(assertGuideStartConsistency(requests)).toEqual({ probe, manifests: requests.slice(1, 3), segments: requests.slice(3) });
});

test("an old matching pair cannot hide a contradictory startup window or older new-load segment", () => {
  const requests = [probe, manifest(111, 5), segment(112, 5), manifest(114, 6), segment(115, 4)];
  expect(() => assertGuideStartConsistency(requests)).toThrow("same advertised startup window");
  expect(() => assertGuideStartConsistency([probe, manifest(111, 5), segment(112, 5), manifest(114, 5), segment(115, 4)])).toThrow("No requested segment");
});

test("live startup retains and rejects pre-probe or pre-manifest requests and later older segments", () => {
  expect(() => assertGuideStartConsistency([manifest(99, 5), probe, manifest(111, 5), segment(112, 5)])).toThrow("follows the fresh host probe");
  expect(() => assertGuideStartConsistency([segment(99, 4), probe, manifest(111, 5), segment(112, 5)])).toThrow("cannot precede");
  expect(() => assertGuideStartConsistency([probe, manifest(111, 5), segment(112, 5), segment(113, 4)])).toThrow("No requested segment");
});

test("startup needs a completed probe, an advertised native window and its newest first segment", () => {
  expect(() => assertGuideStartConsistency([probe, probe, manifest(111, 5), segment(112, 5)])).toThrow("one fresh host probe");
  expect(() => assertGuideStartConsistency([{ ...probe, servedAt: undefined }, manifest(111, 5), segment(112, 5)])).toThrow("follows the fresh host probe");
  expect(() => assertGuideStartConsistency([probe, segment(112, 5)])).toThrow("at least one native manifest");
  expect(() => assertGuideStartConsistency([probe, { ...manifest(111, 5), sequences: [] }, segment(112, 5)])).toThrow("advertised segments");
  expect(() => assertGuideStartConsistency([probe, manifest(111, 5), segment(112, 4)])).toThrow("newest complete segment");
  expect(() => assertGuideStartConsistency([probe, manifest(111, 5), { ...manifest(112, 5), sequences: [2, 4, 5] }, segment(113, 5)])).toThrow("same advertised startup window");
});
