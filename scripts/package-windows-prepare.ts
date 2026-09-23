import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import inputs from "../packaging/inputs.json";
import { packageManager, version } from "../package.json";
import { publicKey, releaseVersion } from "./hosted-policy";

const target = "x86_64-pc-windows-msvc";
const resources = "src-tauri/resources";
const notices = join(resources, "notices");
const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

function run(command: string[]) {
  const result = Bun.spawnSync(command, { stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`Failed: ${command.join(" ")}`);
  return result.stdout.toString().trim();
}

if (`bun@${Bun.version}` !== packageManager) throw new Error(`Use ${packageManager}`);
if (run(["git", "status", "--porcelain"])) throw new Error("Package a clean committed source revision");
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error("Supply TAURI_SIGNING_PRIVATE_KEY for the signed updater archive");
const key = publicKey(process.env.COUCH_UPDATER_PUBLIC_KEY);
await rm(resources, { recursive: true, force: true });
await mkdir(notices, { recursive: true });
await cp("packaging/windows/NOTICE", join(notices, "NOTICE"));
await cp("vendor/streamingcommunity", join(notices, "streamingcommunity"), { recursive: true });

const bunLicense = inputs.notices.find(notice => notice.name === "bun-LICENSE.md")!;
const response = await fetch(bunLicense.url, { signal: AbortSignal.timeout(120_000) });
if (!response.ok) throw new Error(`Bun license download failed: ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
if (sha256(bytes) !== bunLicense.sha256) throw new Error("Bun license SHA-256 mismatch");
await Bun.write(join(notices, bunLicense.name), bytes);

type Package = { name: string; versions: string[]; paths: string[]; license: string };
const groups = JSON.parse(run([process.execPath, "pm", "licenses", "--prod", "--json"])) as Record<string, Package[]>;
const packages = Object.values(groups).flat();
for (const dependency of packages) for (const path of dependency.paths) {
  const directory = join(notices, "javascript", `${dependency.name.replaceAll("/", "_")}@${dependency.versions.join(",")}`);
  await mkdir(directory, { recursive: true });
  for (const file of await readdir(path)) if (/^(license|licence|copying|notice|ofl|unlicense|readme)([._-]|$)/i.test(file)) await cp(join(path, file), join(directory, file));
}
await Bun.write(join(notices, "javascript.json"), JSON.stringify(packages.map(({ paths, ...dependency }) => dependency), null, 2));
run(["cargo", "about", "generate", "--locked", "--fail", "--target", target, "--manifest-path", "src-tauri/Cargo.toml", "--config", "packaging/about.toml", "--output-file", join(notices, "native.txt"), "packaging/about.hbs"]);
await Bun.write(join(resources, "host.json"), JSON.stringify({ target, os: "windows", architecture: "x64", packages: [] }));
await Bun.write(join(resources, "build-inputs.json"), JSON.stringify({ target, bun: run([process.execPath, "--revision"]), rust: run(["rustc", "--version"]), nsis: run(["makensis", "-VERSION"]), xwin: run(["cargo-xwin", "--version"]), cargoAbout: run(["cargo-about", "--version"]), bunLicenseSha256: bunLicense.sha256, locks: Object.fromEntries(await Promise.all(["bun.lock", "src-tauri/Cargo.lock", "rust-toolchain.toml"].map(async path => [path, sha256(new Uint8Array(await Bun.file(path).arrayBuffer()))]))) }, null, 2));

await mkdir(".artifacts", { recursive: true });
await Bun.write(".artifacts/tauri-windows.conf.json", JSON.stringify({
  version: releaseVersion(version),
  bundle: {
    targets: ["nsis"],
    resources: {
      "resources/build-inputs.json": "build-inputs.json",
      "resources/payload.json": "payload.json",
      "resources/release.json": "release.json",
      "resources/notices/": "notices/",
    },
    createUpdaterArtifacts: "v1Compatible",
    windows: { webviewInstallMode: { type: "downloadBootstrapper" }, nsis: { installMode: "currentUser" } },
  },
  plugins: { updater: { pubkey: key, endpoints: ["https://cdn.crabnebula.app/update/avoid-quest/couch/windows-x86_64-nsis/{{current_version}}"], windows: { installMode: "passive" } } },
}));
console.log("Prepared Windows Client-only resources and NSIS configuration");
