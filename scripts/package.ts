import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { version } from "../package.json";
import { appUpdateName, type AppManifest } from "../app/app-update";

// Packages the app with electron-builder, passing the arguments through
// (`bun run package --mac zip --arm64`). The version decides the channel: a
// -preview.N version builds Couch Preview, with its own name, icons and update
// files (preview-*.yml); any other version builds Couch (latest-*.yml). Both
// keep Couch's appId and data directory, so only one of them runs at a time.
const preview = /-preview\.\d+$/.test(version);
const options = preview
  ? [
      "-c.productName=Couch Preview",
      "-c.publish.channel=preview",
      "-c.mac.icon=packaging/icons/preview/icon.icns",
      "-c.win.icon=packaging/icons/preview/icon.ico",
      "-c.linux.icon=packaging/icons/preview/icon.png",
      // The window and tray icon, which app/main.ts reads from the packaged package.json.
      "-c.extraMetadata.icon=packaging/icons/preview/icon.png",
    ]
  : [];
const builder = Bun.spawn(
  ["electron-builder", "--publish", "never", ...options, ...process.argv.slice(2)],
  { stdio: ["inherit", "inherit", "inherit"] },
);
const code = await builder.exited;
if (code === 0 && process.argv.includes("--win")) await appUpdate();
process.exit(code);

// The Windows app-only update (app/app-update.ts): this build's app.asar, and
// the hashes of every other file an installation must already have to take it.
async function appUpdate() {
  const unpacked = ".artifacts/app/win-unpacked";
  const exe = `${preview ? "Couch Preview" : "Couch"}.exe`;
  const asar = join("resources", "app.asar");
  const hash = async (file: string) =>
    createHash("sha256")
      .update(await readFile(join(unpacked, file)))
      .digest("hex");
  const files: AppManifest["files"] = {};
  for (const file of await readdir(unpacked, { recursive: true })) {
    if (file === exe || file === asar || !(await stat(join(unpacked, file))).isFile()) continue;
    files[file.split(sep).join("/")] = await hash(file);
  }
  const manifest: AppManifest = {
    version,
    asar: { sha256: await hash(asar), size: (await stat(join(unpacked, asar))).size },
    files,
  };
  const name = join(".artifacts/app", appUpdateName(version));
  await Bun.write(`${name}.asar`, Bun.file(join(unpacked, asar)));
  await Bun.write(`${name}.json`, JSON.stringify(manifest, null, 2));
}
