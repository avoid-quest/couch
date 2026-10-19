import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { build } from "../package.json";

// electron-builder loads afterPack with Node, whose loader, unlike Bun's, needs each import's extension.
test("Node loads the afterPack hook as electron-builder does", () => {
  const builder = dirname(createRequire(Bun.resolveSync("electron-builder/package.json", import.meta.dir)).resolve("app-builder-lib/package.json"));
  const script = `require(${JSON.stringify(join(builder, "helpers/dynamic-import.js"))}).dynamicImportMaybe(${JSON.stringify(resolve(build.afterPack))}).then(hook => process.exit(typeof (hook.default ?? hook) === "function" ? 0 : 2))`;
  const result = Bun.spawnSync(["node", "-e", script], { stderr: "pipe" });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});
