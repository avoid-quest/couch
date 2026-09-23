import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import inputs from "../packaging/inputs.json";
import { packageManager, version } from "../package.json";
import { publicKey, releaseVersion } from "./hosted-policy";
import { stageMacNative } from "./package-mac-native";

const resources = "src-tauri/resources";
const notices = join(resources, "notices");
const staging = ".artifacts/package-tools";
const target = "aarch64-apple-darwin";
const endpoint = "https://cdn.crabnebula.app/update/avoid-quest/couch/darwin-aarch64/{{current_version}}";
const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

function run(command: string[]) {
  const result = Bun.spawnSync(command, { stderr: "inherit", env: process.env });
  if (result.exitCode !== 0) throw new Error(`Failed: ${command.join(" ")}`);
  return result.stdout.toString().trim();
}

async function download(input: { url: string; sha256: string }, path: string) {
  const response = await fetch(input.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download failed: ${input.url} (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== input.sha256) throw new Error(`SHA-256 mismatch: ${input.url}`);
  await Bun.write(path, bytes);
}

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Build the Apple Silicon DMG on an Apple Silicon Mac");
if (`bun@${Bun.version}` !== packageManager) throw new Error(`Use ${packageManager}`);
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error("Supply the Tauri updater signing key");
if (!("TAURI_SIGNING_PRIVATE_KEY_PASSWORD" in process.env)) throw new Error("Supply the Tauri updater key password (empty for an unencrypted test key)");
process.env.PATH = `${join(homedir(), ".cargo", "bin")}${delimiter}${process.env.PATH ?? ""}`;
const key = publicKey(process.env.COUCH_UPDATER_PUBLIC_KEY);
await rm(resources, { recursive: true, force: true });
await mkdir(notices, { recursive: true });
await mkdir(staging, { recursive: true });
await cp("packaging/NOTICE.mac", join(notices, "NOTICE"));
await download(inputs.notices.find(notice => notice.name === "bun-LICENSE.md")!, join(notices, "bun-LICENSE.md"));
for (const name of ["yt-dlp-LICENSE", "yt-dlp-NOTICES.txt", "deno-LICENSE.md"]) await download(inputs.notices.find(notice => notice.name === name)!, join(notices, name));
const native = await stageMacNative();

type Package = { name: string; versions: string[]; paths: string[]; license: string };
const groups = JSON.parse(run([process.execPath, "pm", "licenses", "--prod", "--json"])) as Record<string, Package[]>;
const packages = Object.values(groups).flat();
for (const dependency of packages) for (const path of dependency.paths) {
  const directory = join(notices, "javascript", `${dependency.name.replaceAll("/", "_")}@${dependency.versions.join(",")}`);
  await mkdir(directory, { recursive: true });
  for (const file of await readdir(path)) if (/^(license|licence|copying|notice|ofl|unlicense|readme)([._-]|$)/i.test(file)) await cp(join(path, file), join(directory, file));
}
await Bun.write(join(notices, "javascript.json"), JSON.stringify(packages.map(({ paths, ...dependency }) => dependency), null, 2));

await download(inputs.cargoAboutMac, join(staging, "cargo-about-mac.tar.gz"));
run(["tar", "-xzf", join(staging, "cargo-about-mac.tar.gz"), "-C", staging]);
const about = (await Bun.file("packaging/about.toml").text()).replace('x86_64-unknown-linux-gnu', target);
await Bun.write(join(staging, "about-mac.toml"), about);
run([join(staging, "cargo-about-0.9.2-aarch64-apple-darwin/cargo-about"), "generate", "--locked", "--fail", "--manifest-path", "src-tauri/Cargo.toml", "--config", join(staging, "about-mac.toml"), "--output-file", join(notices, "native.txt"), "packaging/about.hbs"]);

const locks = Object.fromEntries(await Promise.all(["bun.lock", "src-tauri/Cargo.lock", "rust-toolchain.toml"].map(async path => [path, sha256(new Uint8Array(await Bun.file(path).arrayBuffer()))])));
await Bun.write(join(resources, "build-inputs.json"), JSON.stringify({ cargoAboutMac: inputs.cargoAboutMac, macTools: inputs.macTools, macNativeSha256: sha256(new Uint8Array(await Bun.file(join(resources, "mac-native.json")).arrayBuffer())), bun: run([process.execPath, "--revision"]), rust: run(["rustc", "--version"]), locks }, null, 2));
await Bun.write(join(resources, "host.json"), JSON.stringify({ target, os: "macos", architecture: "arm64", minimumVersion: "26" }));
await mkdir(".artifacts", { recursive: true });
await Bun.write(".artifacts/tauri-mac.conf.json", JSON.stringify({
  version: releaseVersion(version),
  bundle: {
    targets: ["app", "dmg"],
    resources: { "resources/build-inputs.json": "build-inputs.json", "resources/host.json": "host.json", "resources/payload.json": "payload.json", "resources/release.json": "release.json", "resources/tools/": "tools/", "resources/tools.json": "tools.json", "resources/mac-native.json": "mac-native.json", "resources/notices/": "notices/" },
    createUpdaterArtifacts: true,
    macOS: { minimumSystemVersion: "26.0", signingIdentity: "-", entitlements: "Entitlements.mac.plist", frameworks: native.frameworks },
  },
  plugins: { updater: { pubkey: key, endpoints: [endpoint] } },
}));
console.log("Prepared Apple Silicon Full resources and ad-hoc DMG configuration");
