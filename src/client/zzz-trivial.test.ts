import { expect, test } from "bun:test";
import { pairingCodeFromHash } from "./session/pairing-link";
test("pairing links accept only the existing six-digit code and leave native routes alone", () => {
  expect(pairingCodeFromHash("#pair=123456")).toBe("123456");
  for (const hash of ["", "#/settings/connection", "#pair=12345", "#pair=1234567", "#token=secret", "#pair=123456&next=evil"]) expect(pairingCodeFromHash(hash)).toBe("");
});
