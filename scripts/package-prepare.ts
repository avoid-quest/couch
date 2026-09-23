import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { installMediaTools, mediaReleases } from "./setup-media";
import inputs from "../packaging/inputs.json";
import { packageManager, version } from "../package.json";
import packageConfig from "../src-tauri/tauri.package.conf.json";
import debian from "../packaging/debian.json";
import setup from "../packaging/setup/files.json";
import { packageFormat, publicKey, releaseVersion, updaterEndpoint } from "./hosted-policy";

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
  const response = await fetch(input.url, { headers: { Accept: "application/octet-stream" }, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download failed: ${input.url} (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== input.sha256) throw new Error(`SHA-256 mismatch: ${input.url}`);
  await Bun.write(path, bytes);
}

if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Build the production package on Debian 13 x86_64");
const os = await Bun.file("/etc/os-release").text();
if (!/^ID=debian$/m.test(os) || !/^VERSION_ID="13"$/m.test(os)) throw new Error("Debian 13 is required");
if (`bun@${Bun.version}` !== packageManager) throw new Error(`Use ${packageManager}`);
if (run(["git", "status", "--porcelain"])) throw new Error("Package a clean committed source revision");
const format = packageFormat(process.env.COUCH_PACKAGE_FORMAT);
await rm(resources, { recursive: true, force: true });
await mkdir(notices, { recursive: true });
if (format === "deb") {
const tv = join(resources, "tv");
for (const path of setup.files) {
  await mkdir(join(tv, path, ".."), { recursive: true });
  await cp(join("packaging/appliance/root", path), join(tv, path));
}
const unit = join(tv, "usr/lib/systemd/user/couch-tv.service");
await Bun.write(unit, (await Bun.file(unit).text()).replace("ExecStart=/var/lib/couch/application/Couch.AppImage", "ExecStart=/usr/bin/couch"));
await Bun.write(join(tv, "files"), setup.files.join("\n") + "\n");
await Bun.write(join(tv, "packages"), [...new Set([...setup.audio, ...setup.tv, "dbus-user-session", "libpam-systemd", "procps", "polkitd"])].join("\n") + "\n");
await cp("packaging/native/check-tv-health.js", join(tv, "check-health.js"));
const broker = join(resources, "package-update");
await mkdir(broker, { recursive: true });
for (const file of ["couch-package-update@.service", "50-couch-package-update.rules"]) await cp(join("packaging/native", file), join(broker, file));
await Bun.write(join(broker, "couch-updater.pub"), Buffer.from(publicKey(process.env.COUCH_UPDATER_PUBLIC_KEY), "base64"));
}
await mkdir(staging, { recursive: true });
await Bun.write(".artifacts/tauri-release.conf.json", JSON.stringify({ ...packageConfig, bundle: { ...packageConfig.bundle, targets: [format], linux: { ...packageConfig.bundle.linux, ...(format === "deb" ? { deb: debian } : {}) } }, version: releaseVersion(version), plugins: { updater: { pubkey: publicKey(process.env.COUCH_UPDATER_PUBLIC_KEY), endpoints: [updaterEndpoint(format)] } } }));
await installMediaTools(join(resources, "tools"), fetch, inputs.tools);
await cp("/usr/bin/ffprobe", join(resources, "tools", "ffprobe"));
const helpers = {} as Record<string, { version: string; sha256: string; archiveSha256: string }>;
for (const tool of mediaReleases()) helpers[tool.name] = { version: tool.version, sha256: sha256(new Uint8Array(await Bun.file(join(resources, "tools", tool.name)).arrayBuffer())), archiveSha256: inputs.tools[tool.file as keyof typeof inputs.tools] };
helpers.ffprobe = { version: run(["/usr/bin/ffprobe", "-version"]).split(" ")[2]!, sha256: sha256(new Uint8Array(await Bun.file(join(resources, "tools", "ffprobe")).arrayBuffer())), archiveSha256: "" };
await Bun.write(join(resources, "tools.json"), JSON.stringify(helpers, null, 2));
await Bun.write(join(resources, "host.json"), JSON.stringify(format === "deb"
  ? { target: "x86_64-unknown-linux-gnu", os: "debian", version: "13", architecture: "amd64", session: "x11", packages: debian.depends.map(dependency => dependency.split(" ")[0]) }
  : { target: "x86_64-unknown-linux-gnu", os: "linux", architecture: "amd64", session: "desktop", packages: [] }));
for (const notice of inputs.notices) await download(notice, join(notices, notice.name));
await cp("packaging/NOTICE", join(notices, "NOTICE"));
await cp("vendor/streamingcommunity", join(notices, "streamingcommunity"), { recursive: true });
// Retain Debian copyright files for the application libraries copied by linuxdeploy.
for (const name of await readdir("/usr/share/doc")) {
  const copyright = join("/usr/share/doc", name, "copyright");
  if (await Bun.file(copyright).exists()) {
    const directory = join(notices, "debian", name);
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
await Bun.write(join(resources, "build-inputs.json"), JSON.stringify({ ...inputs, ffprobePackage: run(["dpkg-query", "-W", "-f=${Version}", "ffmpeg"]), osRelease: os, rust: run(["rustc", "--version"]), bun: run([process.execPath, "--revision"]), locks: Object.fromEntries(await Promise.all(["bun.lock", "src-tauri/Cargo.lock", "rust-toolchain.toml"].map(async path => [path, sha256(new Uint8Array(await Bun.file(path).arrayBuffer()))]))) }, null, 2));
await Bun.write(join(resources, "build-packages.tsv"), run(["dpkg-query", "-W", "-f=${Package}\t${Version}\t${Architecture}\n"]));
console.log("Prepared pinned package resources and redistribution notices");
