import { expect, test } from "bun:test";
import { verificationPlan, verificationOutcome } from "./verify";

const revision = "a".repeat(40);
const before = { revision, dirty: false };

test("ordinary verification reuses check and build without native or browser setup", () => {
  expect(verificationPlan([])).toEqual([["bun", "run", "check"], ["bun", "run", "build"]]);
});

test("native verification retains both locked native checks only when selected", () => {
  expect(verificationPlan(["--native"])).toEqual([
    ["bun", "run", "check"], ["bun", "run", "build"],
    ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--locked"],
    ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "-p", "tauri-plugin-video", "startup_buffer"],
  ]);
});

test("browser verification reuses the built-sidecar journey instead of a second harness", () => {
  expect(verificationPlan(["--remote"]).at(-1)).toEqual(["bun", "tests/linux/built-remote.ts"]);
  expect(verificationPlan(["--native", "--remote"])).toHaveLength(5);
});

test.each(["--publish", "--release", "--skip-tests", "--unknown"])("unsupported option %s cannot invoke a different verification or release path", option => {
  expect(() => verificationPlan([option])).toThrow("Unknown verification option");
});

test("a complete passing receipt qualifies only the exact clean revision", () => {
  expect(verificationOutcome(before, before, [0, 0], 2)).toEqual({ passed: true, eligible: true });
  expect(verificationOutcome({ ...before, dirty: true }, before, [0, 0], 2)).toEqual({ passed: true, eligible: false });
  expect(verificationOutcome(before, { ...before, dirty: true }, [0, 0], 2)).toEqual({ passed: true, eligible: false });
  expect(verificationOutcome(before, { ...before, revision: "b".repeat(40) }, [0, 0], 2)).toEqual({ passed: true, eligible: false });
});

test("missing steps, process failures and empty runs cannot qualify", () => {
  for (const exits of [[], [0], [0, 1], [127], [0, 0, 0]]) expect(verificationOutcome(before, before, exits, 2)).toEqual({ passed: false, eligible: false });
});
