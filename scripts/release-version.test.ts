import { expect, test } from "bun:test";
import { releaseVersion } from "./release-version";

test("local and retained CI build identities keep distinct versions", () => {
  expect(releaseVersion("0.1.0")).toBe("0.1.0");
  expect(releaseVersion("0.1.0", "34000526418.1")).toBe("0.1.0+build.34000526418.1");
  expect(releaseVersion("0.1.0", "34000526418.2")).not.toBe(releaseVersion("0.1.0", "34000526418.1"));
  expect(releaseVersion("0.1.0", "20260908123456.1")).toBe("0.1.0+build.20260908123456.1");
  for (const id of ["0.1", "1.0", "1", "1.2\n", "../1.2"]) expect(() => releaseVersion("0.1.0", id)).toThrow();
});
