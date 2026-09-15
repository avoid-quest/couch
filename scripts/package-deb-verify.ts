import { strict as assert } from "node:assert";
import { mkdtemp, readdir, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import debian from "../packaging/debian.json";
import { verifyPackageHelpers } from "./package-verify-helpers";

function run(command: string[]) {
  const result = Bun.spawnSync(command, { stderr: "inherit" });
  assert.equal(result.exitCode, 0, command.join(" "));
  return result.stdout.toString().trim();
}
const build = await Bun.file("src-tauri/build-info.json").json();
const directory = "src-tauri/target/release/bundle/deb";
const packages = (await readdir(directory)).filter(file => file.endsWith(".deb"));
assert.equal(packages.length, 1, "Build exactly one native application package");
const archive = join(directory, packages[0]!);
assert.equal(run(["dpkg-deb", "-f", archive, "Package"]), "couch");
assert.equal(run(["dpkg-deb", "-f", archive, "Version"]), build.version);
assert.equal(run(["dpkg-deb", "-f", archive, "Architecture"]), "amd64");
const depends = run(["dpkg-deb", "-f", archive, "Depends"]).split(", ");
for (const dependency of debian.depends) assert.ok(depends.includes(dependency), `Missing ${dependency}`);
assert.ok(!depends.some(dependency => /^(jq|minisign|fuse3|libfuse2)/.test(dependency)));
const staging = await mkdtemp(join(tmpdir(), "couch-deb-"));
const files: { path: string; size: number; sha256: string }[] = [];
try {
  run(["dpkg-deb", "--extract", archive, staging]);
  async function inspect(directory: string) {
    for (const entry of await readdir(directory)) {
      const path = join(directory, entry), stat = await lstat(path), name = relative(staging, path);
      assert.ok(!stat.isSymbolicLink(), `Unexpected package symlink: ${name}`);
      if (stat.isDirectory()) await inspect(path);
      else {
        assert.ok(stat.isFile() && name.startsWith("usr/"), `Unexpected package entry: ${name}`);
        assert.ok(!/(^|\/)(\.git|\.env(?:\..*)?|Cookies|Login Data|History)$|\.(sqlite3?|db|map)$/.test(name), `Private runtime material: ${name}`);
        const bytes = await Bun.file(path).arrayBuffer();
        files.push({ path: name, size: stat.size, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") });
      }
    }
  }
  await inspect(staging);
  for (const path of ["usr/bin/couch", "usr/bin/couch-server", "usr/share/applications/Couch.desktop", "usr/share/doc/couch/NOTICE", "usr/sbin/couch-setup", "usr/share/couch/tv/packages"]) assert.ok(files.some(file => file.path === path), `Missing ${path}`);
  assert.ok((await lstat(join(staging, "usr/sbin/couch-setup"))).mode & 0o111, "TV setup must be executable");
  assert.ok(!files.some(file => /^(etc\/|usr\/(lib\/systemd|share\/lightdm|share\/polkit-1)\/)/.test(file.path)), "Ordinary installation must not activate TV policy");
  const release = await Bun.file(join(staging, "usr/lib/Couch/release.json")).json();
  assert.equal(release.revision, build.revision);
  assert.equal(release.version, build.version);
  assert.deepEqual(release.host.packages, debian.depends.map(dependency => dependency.split(" ")[0]));
  await verifyPackageHelpers(join(staging, "usr/lib/Couch/tools"), build.helpers);
  await Bun.write(".artifacts/deb-inventory.json", JSON.stringify({ build, depends, files: files.sort((a, b) => a.path.localeCompare(b.path)), sha256: new Bun.CryptoHasher("sha256").update(await Bun.file(archive).arrayBuffer()).digest("hex") }, null, 2) + "\n");
} finally {
  await rm(staging, { recursive: true, force: true });
}
console.log(`Verified ${archive}: ${files.length} files, native resources and declared dependencies`);
