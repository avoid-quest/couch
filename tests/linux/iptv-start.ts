import { strict as assert } from "node:assert";
import type { GuideFixture } from "./iptv-fixture";

// HTTP carries no playback ID. Reject overlapping startup candidates instead of
// attributing a convenient pair to the new load; pixels remain a separate gate.
export function assertGuideStart(requests: ReturnType<GuideFixture["requests"]>) {
  const probes = requests.filter(request => !request.native && request.path === "/blue/live.m3u8");
  const native = requests.filter(request => request.native && request.path.startsWith("/blue/"));
  const manifests = native.filter(request => request.path === "/blue/live.m3u8");
  assert.equal(probes.length, 1, "Explicit Go live has one fresh host probe in its complete action-to-playing trace");
  assert.equal(manifests.length, 1, "Native startup attribution is ambiguous unless the complete trace contains exactly one blue manifest");
  const probe = probes[0]!, manifest = manifests[0]!;
  assert.ok(probe.servedAt !== undefined && manifest.at >= probe.servedAt, "The sole native manifest follows the fresh host probe response");
  const segments = native.filter(request => request.path.startsWith("/blue/segments/"));
  assert.ok(segments.length && native.indexOf(segments[0]!) > native.indexOf(manifest), "Native segment requests cannot precede the sole startup manifest");
  const newest = manifest.sequences?.at(-1);
  assert.ok(newest !== undefined, "The native startup manifest retains its advertised segments");
  assert.equal(segments[0]!.sequence, newest, "The first requested segment is the sole manifest's newest complete segment");
  assert.ok(segments.every(request => request.sequence !== undefined && request.sequence >= newest), "No requested segment in the complete startup trace is older than the sole manifest's newest");
  return { probe, manifest, segments };
}
