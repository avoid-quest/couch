import { nodeExecutables } from "./executable.fixture";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSendspin, type SyncedLoad } from "../src/server/sendspin";
import type { PlayerState } from "../src/shared/protocol";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Expected Sendspin lifecycle did not complete.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "couch-sendspin-logging-")),
    marker = join(directory, "started"),
    script = join(directory, "ffmpeg");
  const executables = nodeExecutables(directory, { workers: true });
  const lines: string[] = [],
    states: PlayerState[] = [];
  t.mock.method(console, "log", (line: string) => lines.push(line));
  // Produce no media or physical audio; hold a real child open until Core halts it.
  writeFileSync(
    script,
    `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
    { mode: 0o755 },
  );
  const source = createServer((_request, response) => response.end("fixture input"));
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  const server = createSendspin({
    name: "Test Couch",
    admit: () => false,
    changed: () => {},
    ffmpeg: () => Promise.resolve(script),
  });
  const group = server.group("a".repeat(36), (state) => states.push(state));
  group.members([{ deviceId: "unconnected", level: 100 }]);
  const load: SyncedLoad = {
    type: "load",
    playbackId: "p".repeat(36),
    source: `http://127.0.0.1:${(source.address() as { port: number }).port}/input?sig=synthetic-secret`,
  };
  t.after(async () => {
    group.close();
    await server.close();
    if (existsSync(marker))
      await until(() => {
        try {
          process.kill(Number(readFileSync(marker, "utf8")), 0);
          return false;
        } catch {
          return true;
        }
      });
    source.closeAllConnections();
    await new Promise<void>((resolve) => source.close(() => resolve()));
    assert.deepEqual(await executables.close(), { children: [], workers: [] });
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    group,
    load,
    states,
    marker,
    script,
    errors: () => lines.filter((line) => line.includes("player error ")),
  };
}

for (const action of ["pause", "stop", "close"] as const) {
  test(
    `a deliberate Sendspin ${action} reaps FFmpeg without a playback failure`,
    { timeout: 10_000 },
    async (t) => {
      const f = await fixture(t);
      f.group.send(f.load);
      await until(() => existsSync(f.marker));
      const pid = Number(readFileSync(f.marker, "utf8"));
      if (action === "close") f.group.close();
      else
        f.group.send(
          action === "stop"
            ? { type: "stop" }
            : { type: "pause", playbackId: f.load.playbackId, paused: true },
        );
      await until(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      });
      assert.equal(f.errors().length, 0);
      assert.equal(
        f.states.some((state) => state.status === "error"),
        false,
      );
    },
  );
}

for (const [separator, chunked] of [
  ["", false],
  ["\n", false],
  ["\n", true],
] as const)
  test(
    `Core redacts a complete source before its stderr bound (separator ${JSON.stringify(separator)}, chunked ${chunked})`,
    { timeout: 10_000 },
    async (t) => {
      const f = await fixture(t);
      const username = "synthetic-private-user";
      const prefix =
        "Decoder input refused: ".padEnd(200 - `http://${username}`.length - 1, "x") + " ";
      const source = `http://${username}:synthetic-password@${new URL(f.load.source).host}/movie${separator}/private?sig=synthetic-query`;
      writeFileSync(
        f.script,
        `#!${process.execPath}\nconst message = ${JSON.stringify(prefix)} + process.argv[process.argv.indexOf('-i') + 1];
    ${chunked ? `const cut = message.indexOf("\\n") + 1; process.stderr.write(message.slice(0, cut)); setTimeout(() => { process.stderr.write(message.slice(cut)); process.exitCode = 1; }, 25);` : `console.error(message); process.exitCode = 1;`}\n`,
        { mode: 0o755 },
      );
      f.group.send({ ...f.load, source });
      await until(() => f.states.at(-1)?.status === "error");
      assert.equal(f.errors().length, 1);
      for (const secret of [username, "synthetic-password", "/private", "sig=", "synthetic-query"])
        assert.equal(
          (f.errors()[0]! + f.states.at(-1)!.error!).includes(secret),
          false,
          `Log and published error must omit ${secret}`,
        );
      assert.ok(f.states.at(-1)!.error!.length < 300);
    },
  );

test(
  "Core discards an oversized stderr token and retains the following failure",
  { timeout: 10_000 },
  async (t) => {
    const f = await fixture(t);
    writeFileSync(
      f.script,
      `#!${process.execPath}
    process.stderr.write("Duration: 00:00:20.50\\nError opening input http://synthetic-private-user:" + "x".repeat(5000));
    setTimeout(() => { process.stderr.write("@media.example/private?sig=synthetic-query (Connection refused)\\n"); process.exitCode = 1; }, 25);
  `,
      { mode: 0o755 },
    );
    f.group.send(f.load);
    await until(() => f.states.at(-1)?.status === "error");
    assert.equal(f.errors().length, 1);
    assert.match(f.errors()[0]!, /Connection refused/);
    assert.equal(f.states.at(-1)!.duration, 20.5);
    for (const secret of ["synthetic-private-user", "/private", "sig=", "synthetic-query"])
      assert.equal((f.errors()[0]! + f.states.at(-1)!.error!).includes(secret), false);
  },
);
