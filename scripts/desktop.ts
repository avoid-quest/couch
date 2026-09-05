import { delimiter, join } from "node:path";
import { homedir } from "node:os";

// GUI sessions do not always inherit rustup's PATH setup.
const child = Bun.spawn([process.execPath, Bun.resolveSync("@tauri-apps/cli/tauri.js", import.meta.dir), ...process.argv.slice(2)], {
  env: { ...process.env, PATH: `${join(homedir(), ".cargo", "bin")}${delimiter}${process.env.PATH ?? ""}` },
  stdin: "inherit", stdout: "inherit", stderr: "inherit",
});
process.exit(await child.exited);
