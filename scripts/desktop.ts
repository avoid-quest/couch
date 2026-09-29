import { delimiter, join } from "node:path";
import { homedir } from "node:os";
import { buildCore, watchCore } from "./core";

// GUI sessions do not always inherit rustup's PATH setup.
const path = `${join(homedir(), ".cargo", "bin")}${delimiter}${process.env.PATH ?? ""}`;
if (!Bun.which("cargo", { PATH: path })) throw new Error("Install Rust stable from https://rustup.rs, then rerun bun run desktop.");
if (process.platform === "darwin" && Bun.spawnSync(["xcode-select", "-p"], { stdout: "ignore", stderr: "ignore" }).exitCode !== 0) {
  throw new Error("Install Apple's command-line tools with xcode-select --install, then rerun bun run desktop.");
}
const node = Bun.which("node", { PATH: path });
if (!node || Number(Bun.spawnSync([node, "-p", "process.versions.node.split('.')[0]"]).stdout.toString()) < 24) throw new Error("Install Node 24 or later, then rerun bun run desktop.");
// Tauri restarts the app, and with it Core, when build/core.mjs changes.
await buildCore();
watchCore();
const child = Bun.spawn([process.execPath, Bun.resolveSync("@tauri-apps/cli/tauri.js", import.meta.dir), ...process.argv.slice(2)], {
  env: { ...process.env, COUCH_NODE: node, PATH: path },
  stdin: "inherit", stdout: "inherit", stderr: "inherit",
});
process.exit(await child.exited);
