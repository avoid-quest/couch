import { strict as assert } from "node:assert";
import { join } from "node:path";

const allowed = /^(?:(?:manifest|qualified)\.json(?:\.sig)?|(?:draft|readiness)-(?:preview|stable)\.json|receipts\/(?:upload|publish)-(?:preview|stable)\.json)$/;
const maximum = 256 * 1024;

export function parseReceiptLog(log: string) {
  const lines = [...log.matchAll(/COUCH_RELEASE_RECEIPTS=(\{[^\r\n]*\})\r?$/gm)];
  assert.ok(lines.length, "The run has no retained receipt export. Reuse a locally retained qualified candidate.");
  const json = lines.at(-1)![1]!;
  assert.ok(json.length <= maximum, "Receipt export exceeds 256 KiB");
  const files: Record<string, string> = JSON.parse(json);
  assert.ok(files && !Array.isArray(files) && typeof files === "object");
  for (const [name, contents] of Object.entries(files)) assert.ok(allowed.test(name) && typeof contents === "string", "Unexpected receipt file");
  for (const name of ["manifest.json", "manifest.json.sig", "qualified.json", "qualified.json.sig"]) assert.ok(files[name], `Missing signed receipt: ${name}`);
  return files;
}

if (import.meta.main) {
  const [operation, input, destination] = process.argv.slice(2);
  assert.ok(input, "Supply the receipt directory or downloaded run log");
  if (operation === "export") {
    const files: Record<string, string> = {};
    for await (const name of new Bun.Glob("**/*").scan(input)) {
      if (allowed.test(name)) files[name] = await Bun.file(join(input, name)).text();
    }
    const json = JSON.stringify(files);
    assert.ok(json.length <= maximum, "Receipt export exceeds 256 KiB");
    console.log(`COUCH_RELEASE_RECEIPTS=${json}`);
  } else if (operation === "restore") {
    assert.ok(destination, "Supply a receipt destination");
    const files = parseReceiptLog(await Bun.file(input).text());
    for (const [name, contents] of Object.entries(files)) await Bun.write(join(destination, name), contents);
    // The caller must verify the signatures and original run provenance before using these files.
  } else throw Error("Use export or restore");
}
