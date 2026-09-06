import { strict as assert } from "node:assert";
import type { GuideFixture } from "./iptv-fixture";

// HTTP carries no playback ID. Check the complete trace for contradictions, not
// load identity. mpv stream sniffing and its HLS demuxer can open the same URL.
export function assertGuideStartConsistency(requests: ReturnType<GuideFixture["requests"]>) {
  const probes = requests.filter(request => !request.native && request.path === "/blue/live.m3u8");
  const native = requests.filter(request => request.native && request.path.startsWith("/blue/"));
  const manifests = native.filter(request => request.path === "/blue/live.m3u8");
  assert.equal(probes.length, 1, "Explicit Go live has one fresh host probe in its complete action-to-playing trace");
  assert.ok(manifests.length, "The complete startup trace contains at least one native manifest");
  const probe = probes[0]!, manifest = manifests[0]!;
  assert.ok(probe.servedAt !== undefined && manifests.every(candidate => candidate.at >= probe.servedAt!), "Every native manifest follows the fresh host probe response");
  const segments = native.filter(request => request.path.startsWith("/blue/segments/"));
  assert.ok(segments.length && native.indexOf(segments[0]!) > native.indexOf(manifest), "Native segment requests cannot precede the first startup manifest");
  const newest = manifest.sequences?.at(-1);
  assert.ok(newest !== undefined, "The native startup manifest retains its advertised segments");
  for (const candidate of manifests) assert.deepEqual(candidate.sequences, manifest.sequences, "Every native manifest has the same advertised startup window");
  assert.equal(segments[0]!.sequence, newest, "The first requested segment is the startup window's newest complete segment");
  assert.ok(segments.every(request => request.sequence !== undefined && request.sequence >= newest), "No requested segment in the complete startup trace is older than the startup window's newest");
  return { probe, manifests, segments };
}
