import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Arch, type AfterPackContext } from "electron-builder";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Use electron-builder's actual target, including when packaging across architectures.
// The pure-Go helper needs no Go installation or downloaded dependencies at runtime.
export async function buildRelay(platform: string, arch: string, destination: string) {
  const goos = ({ darwin: "darwin", linux: "linux", win32: "windows" } as Record<string, string>)[platform];
  const goarch = ({ arm64: "arm64", x64: "amd64" } as Record<string, string>)[arch];
  if (!goos || !goarch) throw new Error(`The bundled live relay does not support ${platform}/${arch}.`);
  const options = { cwd: join(root, "native/live-relay"), env: { ...process.env, CGO_ENABLED: "0", GOOS: goos, GOARCH: goarch, GOTOOLCHAIN: "local" }, maxBuffer: 4 * 1024 * 1024 };
  await mkdir(destination, { recursive: true });
  const executable = join(destination, `couch-relay${platform === "win32" ? ".exe" : ""}`);
  try {
    await exec("go", ["build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags=-s -w", "-o", executable, "."], options);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Packaging Couch's live relay requires Go 1.27.2 on PATH. Ordinary frontend/Core builds do not require Go.");
    throw error;
  }
  // Include the licenses of the modules actually linked, plus the Go runtime.
  const modules = (await exec("go", ["list", "-mod=readonly", "-deps", "-f", "{{with .Module}}{{if .Version}}{{.Path}}|{{.Version}}|{{.Dir}}{{end}}{{end}}", "."], options)).stdout;
  const goroot = (await exec("go", ["env", "GOROOT"], options)).stdout.trim();
  const notices = [`Go runtime\n\n${await readFile(join(goroot, "LICENSE"), "utf8")}`];
  for (const entry of new Set(modules.split(/\r?\n/).filter(Boolean))) {
    const [name, version, directory] = entry.split("|");
    if (!name || !version || !directory) throw new Error("Could not identify a bundled relay dependency.");
    const licenses = (await readdir(directory, { withFileTypes: true })).filter(file => file.isFile() && /^(?:licen[sc]e|copying)(?:\..*)?$/i.test(file.name));
    if (!licenses.length) throw new Error(`Missing license for bundled relay dependency ${name}.`);
    for (const file of licenses) notices.push(`${name} ${version} — ${file.name}\n\n${await readFile(join(directory, file.name), "utf8")}`);
  }
  await writeFile(join(destination, "THIRD-PARTY-NOTICES.txt"), notices.join("\n\n--------------------\n\n"));
  console.log(`Built bundled live relay for ${platform}/${arch}`);
}

// afterPack runs before signing, and once for each platform/architecture.
export default async function afterPack(context: AfterPackContext) {
  await buildRelay(context.electronPlatformName, Arch[context.arch], join(context.packager.getResourcesDir(context.appOutDir), "live-relay"));
}

if (import.meta.main) await buildRelay(process.platform, process.arch, join(root, "build/live-relay"));
