import { execFile } from "node:child_process";
import { access, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { arch as hostArch } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// UxPlay 1.74 (GPL-3.0-or-later), the first release with its own mDNS responder and the
// -artp export Couch reads. Git checks the commit; nothing else is downloaded. Couch's one change,
// in native/airplay, accepts a sender's audio only from that sender's address.
export const uxplay = { repository: "https://github.com/FDH2/UxPlay", commit: "d9e293da6d5276315af6820d10542a859bbc3424", version: "1.74" };
const patch = join(root, "native", "airplay", "uxplay-sender-address.patch");
// No X11: Couch renders nothing through UxPlay. No -march=native, which UxPlay's lib/CMakeLists.txt
// otherwise adds on x86, so the package runs on any x86-64 machine, not only the one that built it.
const cmakeFlags = ["-DCMAKE_BUILD_TYPE=Release", "-DNO_X11_DEPS=ON", "-DNO_MARCH_NATIVE=ON"];
// Its build headers. At run time it needs only their libraries and GStreamer's plugins.
export const uxplayBuildPackages = ["cmake", "pkg-config", "libssl-dev", "libplist-dev", "libgstreamer1.0-dev", "libgstreamer-plugins-base1.0-dev"];

const run = (command: string, args: string[], cwd: string) => exec(command, args, { cwd, maxBuffer: 16 * 1024 * 1024 }).catch(error => {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Packaging Couch's AirPlay receiver on Linux requires ${command}. Install ${uxplayBuildPackages.join(" ")} and git.`);
  throw new Error(`${command} ${args.join(" ")} failed:\n${(error as { stderr?: string }).stderr ?? error}`);
});

// Linux only: UxPlay links the system's GStreamer, libplist and OpenSSL, so it is built on the
// distribution family it ships for. The package stages the exact source beside it (GPL-3.0 §6).
export async function buildAirPlay(platform: string, arch: string, destination: string) {
  if (platform !== "linux") return;
  if (arch !== hostArch()) throw new Error(`The AirPlay receiver is built natively; package ${arch} on a ${arch} Linux machine.`);
  const work = join(root, ".artifacts", "uxplay", uxplay.commit), source = join(work, "source"), build = join(work, "build");
  await mkdir(work, { recursive: true });
  if (await access(join(source, ".git")).then(() => false, () => true)) {
    await rm(source, { recursive: true, force: true });
    await mkdir(source);
    await run("git", ["init", "--quiet"], source);
    await run("git", ["fetch", "--quiet", "--depth", "1", uxplay.repository, uxplay.commit], source);
    await run("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], source);
  }
  const head = (await run("git", ["rev-parse", "HEAD"], source)).stdout.trim();
  if (head !== uxplay.commit || (await run("git", ["status", "--porcelain"], source)).stdout.trim()) throw new Error(`${source} is not UxPlay ${uxplay.commit} as published. Remove it and package again.`);
  // A fresh build never mixes another machine's configuration.
  await rm(build, { recursive: true, force: true });
  await run("git", ["apply", patch], source);
  try {
    await run("cmake", ["-S", source, "-B", build, ...cmakeFlags], work);
    await run("cmake", ["--build", build, "--target", "uxplay", "--parallel"], work);
  } finally {
    await run("git", ["checkout", "--quiet", "--", "."], source);
  }
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await copyFile(join(build, "uxplay"), join(destination, "uxplay"));
  await run("strip", [join(destination, "uxplay")], work).catch(() => {});
  const archive = `UxPlay-${uxplay.commit}.tar.gz`;
  await run("git", ["archive", "--format=tar.gz", `--prefix=UxPlay-${uxplay.commit}/`, "-o", join(destination, archive), "HEAD"], source);
  await copyFile(join(source, "LICENSE"), join(destination, "LICENSE"));
  await copyFile(patch, join(destination, "uxplay-sender-address.patch"));
  const libraries = [...(await run("readelf", ["--dynamic", join(destination, "uxplay")], work)).stdout.matchAll(/\(NEEDED\)\s+Shared library: \[(.+)\]/g)].map(match => match[1]!);
  await writeFile(join(destination, "NOTICE.txt"), `Couch's AirPlay receiver is UxPlay ${uxplay.version}, an independent program that Couch runs as a separate process.

UxPlay is free software under the GNU General Public License, version 3 or later (LICENSE).
Couch modified it: uxplay-sender-address.patch, which this package includes, makes it accept a
sender's audio and control packets only from that sender's address. Its complete corresponding
source is ${archive}, the unmodified UxPlay, also at
${uxplay.repository}/tree/${uxplay.commit}
with that patch applied (git apply uxplay-sender-address.patch).
It includes llhttp (MIT, lib/llhttp/LICENSE-MIT), playfair (GPL-3.0, lib/playfair/LICENSE.md)
and files under the LGPL, version 2.1 or later, as each file states.

Built with the patch applied, with CMake: ${cmakeFlags.join(" ")}.
It uses these libraries of the system it runs on, which are not part of this package:
${libraries.join("\n")}

Copyright notices for UxPlay and its contributors are in its source files.
`);
  console.log(`Built UxPlay ${uxplay.version} (${uxplay.commit.slice(0, 7)}) for AirPlay`);
}

if (import.meta.main) await buildAirPlay(process.platform, process.arch, join(root, "build/airplay"));
