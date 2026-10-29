import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Identity } from "@sonn-audio/node-sendspin";
import { openStore } from "../src/server/store";

test("the Sendspin server keeps its SDK identity when Couch restarts", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-sendspin-identity-"));
  try {
    const path = join(directory, "couch.sqlite");
    const first = openStore(path);
    const key = first.sendspinPrivateKey();
    const publicId = Identity.fromPrivateB64u(key).peerId;
    first.close();
    const next = openStore(path);
    expect(Identity.fromPrivateB64u(next.sendspinPrivateKey()).peerId).toBe(publicId);
    next.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
