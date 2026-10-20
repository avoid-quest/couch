import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLog } from "../app/log-file";

const settled = async (path: string, text: string) => {
  const deadline = Date.now() + 2_000;
  while (!(existsSync(path) && readFileSync(path, "utf8").includes(text))) {
    if (Date.now() > deadline) throw new Error(`${path} never received ${text}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

test("a long run keeps its newest output within two bounded files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-log-"));
  try {
    const path = join(directory, "couch.log");
    writeFileSync(path, "previous run tail\n");
    writeFileSync(`${path}.1`, "previous run earlier\n");
    writeFileSync(join(directory, "couch.1.log.1"), "two runs ago\n");
    const write = startLog(path, 200, file => `header run-a log ${file}\n`);
    // The previous run's files move aside whole; an older run's leftover goes.
    expect(readFileSync(join(directory, "couch.1.log"), "utf8")).toBe("previous run tail\n");
    expect(readFileSync(join(directory, "couch.1.log.1"), "utf8")).toBe("previous run earlier\n");
    for (let line = 0; line < 50; line++) write(`line ${line} ${"x".repeat(20)}\n`);
    write(Buffer.from("late failure evidence\n"));
    await settled(path, "late failure evidence");
    const current = readFileSync(path, "utf8"), earlier = readFileSync(`${path}.1`, "utf8");
    expect(current.startsWith("header run-a log ")).toBe(true);
    expect(earlier.startsWith("header run-a log ")).toBe(true);
    expect(Number(/log (\d+)/.exec(current)![1])).toBe(Number(/log (\d+)/.exec(earlier)![1]) + 1);
    expect(earlier).toContain("line 4");
    expect(current).not.toContain("line 0 ");
    for (const file of [path, `${path}.1`]) expect(statSync(file).size).toBeLessThanOrEqual(200);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a log whose directory disappears stops writing without throwing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-log-"));
  const path = join(directory, "couch.log");
  const write = startLog(path, 64, () => "header\n");
  await settled(path, "header");
  rmSync(directory, { recursive: true, force: true });
  expect(() => { for (let line = 0; line < 20; line++) write(`line ${line} after removal\n`); }).not.toThrow();
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(existsSync(directory)).toBe(false);
});
