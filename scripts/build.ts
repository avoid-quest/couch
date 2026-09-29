import { version } from "../package.json";
import { build as viteBuild } from "vite";
import { buildCore, coreBundle } from "./core";

const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim();
const dirty = Bun.spawnSync(["git", "status", "--porcelain"]).stdout.toString().trim() !== "";
const buildInfo = JSON.stringify({ version, revision: /^[a-f0-9]{40}$/.test(revision) ? revision : null, dirty, dataFormat: 1, packaged: false });
await Bun.write("src-tauri/build-info.json", buildInfo);

// One client graph: Vite emits dist, which Tauri packages unchanged and Core
// serves from disk to every other client.
await viteBuild();
await buildCore(buildInfo);
console.log(`Built the frontend into dist and Core into ${coreBundle}`);
