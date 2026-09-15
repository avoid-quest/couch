import { expect, test } from "bun:test";
import { parseReceiptLog } from "./hosted-receipts";

test("run-log fallback restores only complete signed receipt files", () => {
  const files = { "manifest.json": "{}", "manifest.json.sig": "signature", "qualified.json": "{}", "qualified.json.sig": "signature", "receipts/upload-preview.json": "{}" };
  expect(parseReceiptLog(`release\tExport\t2026-09-15T00:00:00Z COUCH_RELEASE_RECEIPTS=${JSON.stringify(files)}\r\n`)).toEqual(files);
  for (const invalid of [{ ...files, "../secret": "bad" }, { ...files, "public/Couch.deb": "binary" }, { ...files, "manifest.json": null }, { ...files, "qualified.json.sig": "" }]) {
    expect(() => parseReceiptLog(`COUCH_RELEASE_RECEIPTS=${JSON.stringify(invalid)}`)).toThrow();
  }
  expect(() => parseReceiptLog("console.log(`COUCH_RELEASE_RECEIPTS=${receipt}`);")).toThrow();
  expect(() => parseReceiptLog(`COUCH_RELEASE_RECEIPTS=${JSON.stringify({ ...files, "manifest.json": "x".repeat(262144) })}`)).toThrow("256 KiB");
});
