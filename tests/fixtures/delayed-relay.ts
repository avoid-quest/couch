import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { executableName, nodeExecutables } from "../executable.fixture";

// Real Node child with explicit startup barriers, never real TURN credentials.
export async function delayedRelay(directory: string) {
  const fixtures = nodeExecutables(directory);
  const executable = join(directory, executableName("delayed-relay"));
  await writeFile(executable, `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const directory = ${JSON.stringify(directory)};
process.stdin.once("data", () => {
  let run = 1;
  while (fs.existsSync(path.join(directory, "started-" + run))) run++;
  fs.writeFileSync(path.join(directory, "started-" + run), "");
  const timer = setInterval(() => {
    if (!fs.existsSync(path.join(directory, "ready-" + run))) return;
    clearInterval(timer);
    process.stdout.write(JSON.stringify({ port: 40000 + run }) + "\\n");
  }, 10);
});
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
`, { mode: 0o755 });
  return {
    executable,
    close: () => fixtures.close(),
    async started(run: number) {
      const deadline = Date.now() + 4000;
      for (;;) {
        try { await access(join(directory, `started-${run}`)); return; } catch {}
        assert.ok(Date.now() < deadline, "test helper did not start");
        await sleep(10);
      }
    },
    release: (run: number) => writeFile(join(directory, `ready-${run}`), ""),
  };
}
