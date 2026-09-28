import { strict as assert } from "node:assert";
import { realpathSync } from "node:fs";
import { chmod, cp, mkdir, readdir, symlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import inputs from "../packaging/inputs.json";
import { binaryArchitectures } from "./desktop-payload";

const resources = "src-tauri/resources";
const libraries = join(resources, "mac-libraries");
const tools = join(resources, "tools");
const notices = join(resources, "notices", "macos-native");
const sha256 = async (path: string) => new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");

function run(command: string[]) {
  const result = Bun.spawnSync(command);
  assert.equal(result.exitCode, 0, `${command.join(" ")}\n${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function links(path: string) {
  return run(["otool", "-L", path]).split("\n").filter(line => line.startsWith("\t")).map(line => line.trim().split(" (compatibility version")[0]!);
}

type FormulaInfo = {
  name: string;
  license: string;
  versions: { stable: string };
  revision: number;
  installed: { version: string; poured_from_bottle: boolean }[];
  urls: { stable: { url: string; checksum: string | null; revision: string | null } };
  bottle: { stable: { files: Record<string, { sha256: string }> } };
};

async function discoverNative() {
  const mpv = join(run(["brew", "--prefix", "mpv"]), "lib", "libmpv.2.dylib");
  const mpvExecutable = join(run(["brew", "--prefix", "mpv"]), "bin", "mpv");
  const ffmpegPrefix = run(["brew", "--prefix", "ffmpeg"]);
  const ffmpeg = join(ffmpegPrefix, "bin", "ffmpeg");
  const ffprobe = join(ffmpegPrefix, "bin", "ffprobe");
  const cellar = "/opt/homebrew/Cellar/";
  const sources = new Map<string, string>([[realpathSync(mpv), mpv]]);
  const visited = new Set<string>();
  const queue = [mpv, mpvExecutable, ffmpeg, ffprobe];
  while (queue.length) {
    const path = queue.pop()!;
    const actual = realpathSync(path);
    if (visited.has(actual)) continue;
    visited.add(actual);
    const ownIds = new Set(run(["otool", "-D", path]).split("\n").filter(line => line && !line.endsWith(":")));
    for (const dependency of links(path)) {
      if (ownIds.has(dependency) || dependency.startsWith("/System/Library/") || dependency.startsWith("/usr/lib/")) continue;
      assert.ok(dependency.startsWith("/opt/homebrew/"), `Unresolved native dependency: ${path} -> ${dependency}`);
      const resolved = realpathSync(dependency);
      assert.ok(resolved.startsWith(cellar), `Dependency outside Homebrew Cellar: ${dependency}`);
      sources.set(resolved, dependency);
      queue.push(dependency);
    }
  }
  const libraries = await Promise.all([...sources].map(async ([actual, source]) => {
    assert.ok((await binaryArchitectures(actual)).includes("aarch64"), `Wrong library architecture: ${source}`);
    return { name: basename(actual), source, sha256: await sha256(actual), formula: actual.slice(cellar.length).split("/")[0]! };
  }));
  libraries.sort((a, b) => a.name.localeCompare(b.name));
  assert.equal(new Set(libraries.map(library => library.name)).size, libraries.length, "Homebrew libraries have colliding bundle names");
  const names = [...new Set([...libraries.map(library => library.formula), "mpv", "ffmpeg"])].sort();
  const info = JSON.parse(run(["brew", "info", "--json=v2", ...names])).formulae as FormulaInfo[];
  assert.deepEqual(info.map(formula => formula.name).sort(), names, "Missing Homebrew formula provenance");
  const formulas = info.map(formula => {
    assert.equal(formula.installed.length, 1, `Expected one installed ${formula.name} version`);
    assert.ok(formula.installed[0]!.poured_from_bottle, `Expected a Homebrew bottle for ${formula.name}`);
    assert.equal(formula.installed[0]!.version, `${formula.versions.stable}${formula.revision ? `_${formula.revision}` : ""}`, `Installed ${formula.name} differs from its source metadata`);
    const source = formula.urls.stable;
    const bottleSha256 = formula.bottle.stable.files.arm64_tahoe?.sha256;
    assert.ok(source.url && (source.checksum || source.revision) && bottleSha256, `Missing source or bottle provenance: ${formula.name}`);
    return { name: formula.name, version: formula.installed[0]!.version, license: formula.license, source: source.url, sourceSha256: source.checksum, sourceRevision: source.revision, bottleSha256 };
  });
  const mpvVersion = formulas.find(formula => formula.name === "mpv")!.version;
  const probeVersion = run([ffprobe, "-version"]).match(/^ffprobe version (\S+)/)?.[1];
  assert.ok(probeVersion, "Cannot read ffprobe version");
  const ffmpegVersion = run([ffmpeg, "-version"]).match(/^ffmpeg version (\S+)/)?.[1];
  assert.ok(ffmpegVersion, "Cannot read ffmpeg version");
  return { target: "aarch64-apple-darwin", mpvVersion, mpv: { source: mpvExecutable, sha256: await sha256(mpvExecutable) }, ffmpeg: { source: ffmpeg, sha256: await sha256(ffmpeg), version: ffmpegVersion }, ffprobe: { source: ffprobe, sha256: await sha256(ffprobe), version: probeVersion }, formulas, libraries };
}

async function download(input: { url: string; sha256: string }, path: string) {
  const response = await fetch(input.url, { signal: AbortSignal.timeout(120_000) });
  assert.ok(response.ok, `Cannot download ${input.url}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), input.sha256, `Changed download: ${input.url}`);
  await Bun.write(path, bytes);
}

async function copyNotices(formula: string) {
  const prefix = run(["brew", "--prefix", formula]);
  let found = 0;
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /^(?:license|licence|copying|copyright)(?:[._-]|$)/i.test(entry.name)) {
        const destination = join(notices, formula, entry.name);
        await mkdir(join(notices, formula), { recursive: true });
        if (!await Bun.file(destination).exists()) await cp(path, destination);
        found++;
      }
    }
  }
  await walk(prefix);
  if (!found) {
    const fallback = formula === "glib" ? "LGPL-2.1-only" : formula === "libunibreak" ? "Zlib" : null;
    assert.ok(fallback, `No installed license text for ${formula}`);
    const pinned = {
      "LGPL-2.1-only": "5749785c8bdefafcb5d798270ed0a967036fe2ca63dcedade1627565dfef81d2",
      Zlib: "bfb1112d49db5b1daecdfef24bd7e2f3ea0bafb33aa67aa0ab51e2bf8407c03d",
    } as const;
    await mkdir(join(notices, formula), { recursive: true });
    await download({ url: `https://raw.githubusercontent.com/spdx/license-list-data/v3.29.0/text/${fallback}.txt`, sha256: pinned[fallback] }, join(notices, formula, `${fallback}.txt`));
  }
}

export async function stageMacNative() {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  const native = await discoverNative();
  const expected = new Map(native.libraries.map(library => [realpathSync(library.source), library]));
  await mkdir(libraries, { recursive: true });
  await mkdir(tools, { recursive: true });
  const staged = [];
  for (const library of native.libraries) {
    assert.equal(await sha256(library.source), library.sha256, `Changed Homebrew library: ${library.source}`);
    assert.ok((await binaryArchitectures(library.source)).includes("aarch64"), `Wrong library architecture: ${library.source}`);
    const destination = join(libraries, library.name);
    await cp(realpathSync(library.source), destination);
    await chmod(destination, 0o755);
    run(["install_name_tool", "-id", `@rpath/${library.name}`, destination]);
    for (const dependency of links(library.source)) if (dependency.startsWith("/opt/homebrew/") && realpathSync(dependency) !== realpathSync(library.source)) {
      run(["install_name_tool", "-change", dependency, `@loader_path/${expected.get(realpathSync(dependency))!.name}`, destination]);
    }
    run(["codesign", "--force", "--sign", "-", destination]);
    staged.push({ ...library, bundledSha256: await sha256(destination) });
  }
  for (const name of ["ffmpeg", "ffprobe"] as const) {
    const source = native[name].source, executable = join(tools, name);
    assert.equal(await sha256(source), native[name].sha256, `Changed Homebrew ${name}`);
    await cp(realpathSync(source), executable);
    await chmod(executable, 0o755);
    for (const dependency of links(source)) if (dependency.startsWith("/opt/homebrew/")) {
      run(["install_name_tool", "-change", dependency, `@executable_path/../../Frameworks/${expected.get(realpathSync(dependency))!.name}`, executable]);
    }
    run(["codesign", "--force", "--sign", "-", executable]);
  }
  const player = join(tools, "mpv");
  await cp(realpathSync(native.mpv.source), player);
  await chmod(player, 0o755);
  for (const dependency of links(native.mpv.source)) if (dependency.startsWith("/opt/homebrew/")) {
    run(["install_name_tool", "-change", dependency, `@executable_path/../../Frameworks/${expected.get(realpathSync(dependency))!.name}`, player]);
  }
  run(["codesign", "--force", "--sign", "-", player]);
  await download(inputs.macTools["yt-dlp_macos"], join(tools, "yt-dlp"));
  await chmod(join(tools, "yt-dlp"), 0o755);
  run(["codesign", "--force", "--sign", "-", join(tools, "yt-dlp")]);
  const archive = ".artifacts/package-tools/deno-mac.zip";
  await download(inputs.macTools["deno-aarch64-apple-darwin.zip"], archive);
  run(["unzip", "-o", "-q", archive, "deno", "-d", ".artifacts/package-tools"]);
  await cp(".artifacts/package-tools/deno", join(tools, "deno"));
  await chmod(join(tools, "deno"), 0o755);
  run(["codesign", "--force", "--sign", "-", join(tools, "deno")]);
  for (const name of ["ffmpeg", "ffprobe", "yt-dlp", "deno"] as const) assert.ok((await binaryArchitectures(join(tools, name))).includes("aarch64"), `Wrong helper architecture: ${name}`);
  assert.ok((await binaryArchitectures(player)).includes("aarch64"), "Wrong mpv architecture");
  const helpers = {
    "yt-dlp": { version: "2026.08.19", sha256: await sha256(join(tools, "yt-dlp")), archiveSha256: inputs.macTools["yt-dlp_macos"].sha256 },
    deno: { version: "2.9.6", sha256: await sha256(join(tools, "deno")), archiveSha256: inputs.macTools["deno-aarch64-apple-darwin.zip"].sha256 },
    ffmpeg: { version: native.ffmpeg.version, sha256: await sha256(join(tools, "ffmpeg")), archiveSha256: "" },
    ffprobe: { version: native.ffprobe.version, sha256: await sha256(join(tools, "ffprobe")), archiveSha256: "" },
  };
  await Bun.write(join(resources, "tools.json"), JSON.stringify(helpers, null, 2));
  await Bun.write(join(resources, "mac-native.json"), JSON.stringify({ ...native, libraries: staged, mpv: { ...native.mpv, bundledSha256: await sha256(player) }, ffmpeg: { ...native.ffmpeg, bundledSha256: helpers.ffmpeg.sha256 }, ffprobe: { ...native.ffprobe, bundledSha256: helpers.ffprobe.sha256 } }, null, 2));
  await mkdir(notices, { recursive: true });
  await Bun.write(join(notices, "sources.json"), JSON.stringify(native.formulas, null, 2));
  for (const formula of native.formulas) {
    await copyNotices(formula.name);
  }
  const prefix = join(resources, "mac-mpv");
  await mkdir(join(prefix, "lib"), { recursive: true });
  await symlink("/opt/homebrew/opt/mpv/include", join(prefix, "include"));
  await symlink(resolve(libraries, "libmpv.2.dylib"), join(prefix, "lib", "libmpv.dylib"));
  return { prefix: resolve(prefix), frameworks: native.libraries.map(library => `./resources/mac-libraries/${library.name}`) };
}
