import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { installMediaTools, mediaReleases } from "./setup-media";
import inputs from "../packaging/inputs.json";
import { packageManager, version } from "../package.json";
import packageConfig from "../src-tauri/tauri.package.conf.json";
import { releaseVersion } from "./release-version";

const resources = "src-tauri/resources";
const notices = join(resources, "notices");
const staging = ".artifacts/package-tools";
const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

function run(command: string[]) {
  const result = Bun.spawnSync(command, { stderr: "inherit" });
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

if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Build the production package on Ubuntu 24.04 x86_64");
if (!(await Bun.file("/etc/os-release").text()).includes('VERSION_ID="24.04"')) throw new Error("Ubuntu 24.04 is required");
if (`bun@${Bun.version}` !== packageManager) throw new Error(`Use ${packageManager}`);
if (run(["git", "status", "--porcelain"])) throw new Error("Package a clean committed source revision");
await rm(resources, { recursive: true, force: true });
await mkdir(notices, { recursive: true });
await mkdir(staging, { recursive: true });
await Bun.write(".artifacts/tauri-release.conf.json", JSON.stringify({ ...packageConfig, version: releaseVersion(version, process.env.COUCH_RELEASE_ID) }));
await installMediaTools(join(resources, "tools"), fetch, inputs.tools);
const helpers = {} as Record<string, { version: string; sha256: string; archiveSha256: string }>;
for (const tool of mediaReleases()) helpers[tool.name] = { version: tool.version, sha256: sha256(new Uint8Array(await Bun.file(join(resources, "tools", tool.name)).arrayBuffer())), archiveSha256: inputs.tools[tool.file as keyof typeof inputs.tools] };
await Bun.write(join(resources, "tools.json"), JSON.stringify(helpers, null, 2));
for (const notice of inputs.notices) await download(notice, join(notices, notice.name));
await cp("packaging/NOTICE", join(notices, "NOTICE"));
// AppImage redistributes Ubuntu libraries that Debian normally supplies separately.
for (const name of await readdir("/usr/share/doc")) {
  const copyright = join("/usr/share/doc", name, "copyright");
  if (await Bun.file(copyright).exists()) {
    const directory = join(notices, "ubuntu", name);
    await mkdir(directory, { recursive: true });
    await cp(copyright, join(directory, "copyright"), { dereference: true });
  }
}

// Bun supplies the resolved production graph; retain its upstream license files.
type Package = { name: string; versions: string[]; paths: string[]; license: string };
const groups = JSON.parse(run([process.execPath, "pm", "licenses", "--prod", "--json"])) as Record<string, Package[]>;
const packages = Object.values(groups).flat();
for (const dependency of packages) for (const path of dependency.paths) {
  const directory = join(notices, "javascript", `${dependency.name.replaceAll("/", "_")}@${dependency.versions.join(",")}`);
  await mkdir(directory, { recursive: true });
  for (const file of await readdir(path)) if (/^(license|licence|copying|notice|ofl|unlicense|readme)([._-]|$)/i.test(file)) await cp(join(path, file), join(directory, file));
}
await Bun.write(join(notices, "javascript.json"), JSON.stringify(packages.map(({ paths, ...dependency }) => dependency), null, 2));
await download(inputs.cargoAbout, join(staging, "cargo-about.tar.gz"));
run(["tar", "-xzf", join(staging, "cargo-about.tar.gz"), "-C", staging]);
run([join(staging, "cargo-about-0.9.2-x86_64-unknown-linux-musl/cargo-about"), "generate", "--locked", "--fail", "--manifest-path", "src-tauri/Cargo.toml", "--config", "packaging/about.toml", "--output-file", join(notices, "native.txt"), "packaging/about.hbs"]);
await Bun.write(join(resources, "build-inputs.json"), JSON.stringify({ ...inputs, rust: run(["rustc", "--version"]), bun: run([process.execPath, "--revision"]), locks: Object.fromEntries(await Promise.all(["bun.lock", "src-tauri/Cargo.lock", "rust-toolchain.toml"].map(async path => [path, sha256(new Uint8Array(await Bun.file(path).arrayBuffer()))]))) }, null, 2));
await Bun.write(join(resources, "build-packages.tsv"), run(["dpkg-query", "-W", "-f=${Package}\t${Version}\t${Architecture}\n"]));
console.log("Prepared pinned package resources and redistribution notices");
