import { describe, expect, test } from "bun:test";
import { releasePending } from "./release-pending";

test("a missing tag and an older feed leave the release pending", async () => {
  const result = await releasePending("0.1.6-preview.1", { tagExists: async () => false, feedVersion: async () => "0.1.5" });
  expect(result.pending).toBe(true);
});

test("an existing tag or a feed at or past the version skips the release", async () => {
  expect((await releasePending("0.1.5", { tagExists: async () => true, feedVersion: async () => null })).pending).toBe(false);
  expect((await releasePending("0.1.5", { tagExists: async () => false, feedVersion: async () => "0.1.5" })).pending).toBe(false);
  expect((await releasePending("0.1.4", { tagExists: async () => false, feedVersion: async () => "0.1.5" })).pending).toBe(false);
});

test("an empty or unreachable feed stays pending and invalid versions throw", async () => {
  expect((await releasePending("0.1.6-preview.0", { tagExists: async () => false, feedVersion: async () => null })).pending).toBe(true);
  expect(() => releasePending("0.1.0+build.1.1", { tagExists: async () => false, feedVersion: async () => null })).toThrow();
});
