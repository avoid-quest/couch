import { delimiter, join } from "node:path";
import { homedir } from "node:os";

// GUI sessions do not always inherit rustup's PATH setup.
const path = `${join(homedir(), ".cargo", "bin")}${delimiter}${process.env.PATH ?? ""}`;
if (!Bun.which("cargo", { PATH: path })) throw new Error("Install Rust stable from https://rustup.rs, then rerun bun run desktop.");
if (process.platform === "darwin" && Bun.spawnSync(["xcode-select", "-p"], { stdout: "ignore", stderr: "ignore" }).exitCode !== 0) {
  throw new Error("Install Apple's command-line tools with xcode-select --install, then rerun bun run desktop.");
}
const child = Bun.spawn([process.execPath, Bun.resolveSync("@tauri-apps/cli/tauri.js", import.meta.dir), ...process.argv.slice(2)], {
  env: { ...process.env, COUCH_DEV_BUN: process.execPath, PATH: path },
  stdin: "inherit", stdout: "inherit", stderr: "inherit",
});
process.exit(await child.exited);
