import { expect, test } from "bun:test";
import { releaseVersion } from "./release-version";

test("CI attempts get distinct versions without changing development builds", () => {
  expect(releaseVersion("0.1.0")).toBe("0.1.0");
  expect(releaseVersion("0.1.0", "34000526418.1")).toBe("0.1.0+build.34000526418.1");
  expect(releaseVersion("0.1.0", "34000526418.2")).not.toBe(releaseVersion("0.1.0", "34000526418.1"));
  for (const id of ["0.1", "1.0", "1", "1.2\n", "../1.2"]) expect(() => releaseVersion("0.1.0", id)).toThrow();
});
