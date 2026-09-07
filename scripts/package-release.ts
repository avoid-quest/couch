import { strict as assert } from "node:assert";
import { cp, mkdir, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { version } from "../package.json";
import { releaseVersion } from "./release-version";

const releaseId = process.env.COUCH_RELEASE_ID;
assert.ok(releaseId, "Only an identified CI attempt can produce a release artifact");
const packageDirectory = ".artifacts/package-release";
const output = ".artifacts/qualified-release";
const build = await Bun.file("src-tauri/build-info.json").json();
assert.equal(build.version, releaseVersion(version, releaseId));
assert.equal(build.dirty, false);
assert.equal(build.packaged, true);
assert.equal(build.dataFormat, 1);
assert.match(build.revision, /^[a-f0-9]{40}$/);
assert.equal(build.target, "x86_64-unknown-linux-gnu");
const files = (await readdir(packageDirectory)).filter(file => file.endsWith(".deb"));
assert.equal(files.length, 1, "Qualification produces exactly one native Couch package");
const packagePath = join(packageDirectory, files[0]!);
const bytes = new Uint8Array(await Bun.file(packagePath).arrayBuffer());
const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const evidence = (await readdir(".artifacts/package-qualification")).sort();
assert.equal(evidence.length, 1, "Use this attempt's fresh qualification evidence");
const qualification = await Bun.file(join(".artifacts/package-qualification", evidence[0]!, "result.json")).json();
assert.deepEqual(qualification.build, build);
assert.equal(qualification.packageSha256, sha256);
assert.ok(qualification.checks.length > 0);
const query = Bun.spawnSync(["dpkg-deb", "--field", packagePath, "Package", "Version", "Architecture"]);
assert.equal(query.exitCode, 0);
const fields = Object.fromEntries(query.stdout.toString().trim().split("\n").map(line => line.split(": ")));
assert.deepEqual(fields, { Package: "couch", Version: build.version, Architecture: "amd64" });
const companion = Bun.spawnSync(["sh", "scripts/build-appliance.sh", output, build.version], { stderr: "inherit" });
assert.equal(companion.exitCode, 0);
const companionFilename = `couch-appliance_${build.version}_all.deb`;
const companionBytes = new Uint8Array(await Bun.file(join(output, companionFilename)).arrayBuffer());
const manifest = {
  schemaVersion: 1,
  releaseId,
  build,
  ci: { repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, workflow: "Package", ref: process.env.GITHUB_REF_NAME },
  compatibility: { dataFormat: 1, os: "ubuntu", osVersion: "24.04", architecture: "amd64", data: "Preserve the existing absolute COUCH_DATA_DIR and its account permissions.", appliancePackage: "Install both packages at the exact listed version through the supported APT installer." },
  releaseNotes: process.env.COUCH_RELEASE_NOTES?.trim() || `Qualified build of ${build.revision}.`,
  packages: [{ name: "couch", version: build.version, architecture: "amd64", filename: basename(packagePath), size: bytes.length, sha256 }, { name: "couch-appliance", version: build.version, architecture: "all", filename: companionFilename, size: companionBytes.length, sha256: new Bun.CryptoHasher("sha256").update(companionBytes).digest("hex") }],
  qualification: { checks: qualification.checks, display: qualification.display },
};
await mkdir(output, { recursive: true });
await cp(packagePath, join(output, basename(packagePath)));
await Bun.write(join(output, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Qualified immutable release ${releaseId}: ${build.version}, ${sha256}`);
