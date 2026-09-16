/** Mirror the package.json version into the Tauri and Cargo identity files. */
import { releaseVersion } from "./hosted-policy";

type Paths = { packageJson: string; tauriConf: string; cargoToml: string; cargoLock: string };

const defaultPaths: Paths = { packageJson: "package.json", tauriConf: "src-tauri/tauri.conf.json", cargoToml: "src-tauri/Cargo.toml", cargoLock: "src-tauri/Cargo.lock" };

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function syncVersions(paths: Paths = defaultPaths) {
  const version = releaseVersion((await Bun.file(paths.packageJson).json()).version);
  const tauriText = await Bun.file(paths.tauriConf).text();
  const tauriVersion = (JSON.parse(tauriText) as { version: string }).version;
  const cargoText = await Bun.file(paths.cargoToml).text();
  const lockText = await Bun.file(paths.cargoLock).text();
  // Idempotent: already-synced trees rewrite identical bytes.
  const cargoBlock = new RegExp(`^version = "${escapeRegExp(tauriVersion)}"$`, "m");
  const lockBlock = new RegExp(`(\\[\\[package\\]\\]\\nname = "couch"\\nversion = ")${escapeRegExp(tauriVersion)}(")`);
  if (!cargoBlock.test(cargoText)) throw new Error(`Cargo.toml version is not ${tauriVersion}; package.json, Tauri and Cargo versions must match.`);
  if (!lockBlock.test(lockText)) throw new Error(`Cargo.lock couch version is not ${tauriVersion}; the --locked release build would fail.`);
  await Bun.write(paths.tauriConf, tauriText.replace(`"version": ${JSON.stringify(tauriVersion)}`, `"version": ${JSON.stringify(version)}`));
  await Bun.write(paths.cargoToml, cargoText.replace(cargoBlock, `version = "${version}"`));
  await Bun.write(paths.cargoLock, lockText.replace(lockBlock, `$1${version}$2`));
  return version;
}

if (import.meta.main) {
  console.log(`Synced versions to ${await syncVersions()}`);
}
