import { expect, test } from "bun:test";
import { verifyTrialTools } from "./trial-tools";

test("retries a failed fresh tool verification before requiring recovery", async () => {
  let calls = 0, waits = 0;
  await verifyTrialTools(async () => { if (++calls === 1) throw new Error("Package tools failed fresh hash/version checks."); }, async () => { waits++; });
  expect({ calls, waits }).toEqual({ calls: 2, waits: 1 });
});

test("keeps the second verification failure", async () => {
  const error = new Error("Deno: The package tool could not be read within the check limits.");
  await expect(verifyTrialTools(async () => { throw error; }, async () => {})).rejects.toBe(error);
});
