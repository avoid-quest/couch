import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createForwarder } from "../src/server/live-forward";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

// A stand-in for couch-relay forward: it records every command and fails the peer named "failing".
const helper = () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-forward-"));
  directories.push(directory);
  const executable = join(directory, "couch-relay");
  const log = join(directory, "commands");
  writeFileSync(
    executable,
    `#!${process.execPath}
const { appendFileSync } = require("node:fs");
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  appendFileSync(${JSON.stringify(log)}, line + "\\n");
  const command = JSON.parse(line);
  if (command.op === "downlink" && command.peer === "failing")
    console.log(JSON.stringify({ op: "failed", peer: command.peer, error: "refused" }));
});
`,
  );
  chmodSync(executable, 0o755);
  const commands = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as { op: string; peer: string })
      : [];
  return { executable, commands };
};

test("a peer the helper fails is closed in the helper when Core drops it", async () => {
  const { executable, commands } = helper();
  const failed: string[] = [];
  const forwarder = createForwarder({
    executable,
    iceServers: () => [],
    signal: () => {},
    // Core drops a failed peer, as live-input.ts does.
    failed: (peerId) => {
      failed.push(peerId);
      forwarder.close(peerId);
    },
  });
  forwarder.uplink("uplink", "share", true, true);
  forwarder.downlink("staying", "share", true, true);
  forwarder.downlink("failing", "share", true, true);
  for (let tries = 0; tries < 200 && !commands().some(({ op }) => op === "close"); tries++)
    await Bun.sleep(10);
  forwarder.stop();
  expect(failed).toEqual(["failing"]);
  expect(commands()).toContainEqual({ op: "close", peer: "failing" });
});
