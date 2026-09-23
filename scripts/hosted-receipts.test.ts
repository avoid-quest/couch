import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("run-log restoration creates nested upload receipt directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "couch-receipt-restore-"));
  const files = { "manifest.json": "{}", "manifest.json.sig": "signature", "qualified.json": "{}", "qualified.json.sig": "signature", "receipts/upload-preview.json": "uploaded" };
  try {
    const log = join(root, "run.log"), destination = join(root, "restored");
    await Bun.write(log, `COUCH_RELEASE_RECEIPTS=${JSON.stringify(files)}\n`);
    const result = Bun.spawnSync([process.execPath, "scripts/hosted-receipts.ts", "restore", log, destination], { stderr: "pipe" });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(await Bun.file(join(destination, "receipts/upload-preview.json")).text()).toBe("uploaded");
  } finally { await rm(root, { recursive: true, force: true }); }
});
