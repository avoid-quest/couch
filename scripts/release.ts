import { version as packageVersion } from "../package.json";

// Resolves what release.yml publishes and prints it as GITHUB_OUTPUT lines:
// channel, version, tag, name, ref, previous_tag and skip.
//   preview     HEAD as <base>-preview.<N>. The base is package.json's version,
//               or the patch after the last production tag when that is
//               higher; N follows the highest preview of that base. Skipped
//               when HEAD already carries a preview tag.
//   production  The latest preview's commit, without the -preview.N suffix.
// previous_tag is the release before it on the same channel, for the notes.
const channel = process.argv[2];
if (channel !== "preview" && channel !== "production") throw new Error("Usage: bun scripts/release.ts preview|production");

const git = (...args: string[]) => {
  const result = Bun.spawnSync(["git", ...args]);
  if (!result.success) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.toString().trim();
};
// [major, minor, patch, preview number]; a production version sorts after its previews.
const compare = (a: number[], b: number[]) => { for (const [i, n] of a.entries()) if (n !== b[i]) return n - b[i]!; return 0; };
const releases = git("tag", "--list", "v*").split("\n").flatMap(tag => {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$/.exec(tag);
  return match ? [{ tag, preview: match[4] !== undefined, parts: match.slice(1).map(n => n === undefined ? Infinity : Number(n)) }] : [];
}).sort((a, b) => compare(a.parts, b.parts));
const previews = releases.filter(release => release.preview);
const productions = releases.filter(release => !release.preview);

let parts: number[];
let ref: string;
let skip = false;
if (channel === "preview") {
  if (!/^\d+\.\d+\.\d+$/.test(packageVersion)) throw new Error(`package.json's version ${packageVersion} should be X.Y.Z`);
  const [major, minor, patch] = productions.at(-1)?.parts ?? [0, 0, -1];
  const next = [major!, minor!, patch! + 1];
  const own = packageVersion.split(".").map(Number);
  const base = compare(next, own) > 0 ? next : own;
  const n = Math.max(0, ...previews.filter(release => compare(release.parts.slice(0, 3), base) === 0).map(release => release.parts[3]!));
  parts = [...base, n + 1];
  ref = git("rev-parse", "HEAD");
  skip = git("tag", "--points-at", "HEAD").split("\n").some(tag => /^v\d+\.\d+\.\d+-preview\.\d+$/.test(tag));
} else {
  const latest = previews.at(-1);
  if (!latest) throw new Error("No preview to promote");
  parts = [...latest.parts.slice(0, 3), Infinity];
  if (productions.some(release => compare(release.parts, parts) === 0)) throw new Error(`${latest.tag} was promoted already; publish a newer preview first`);
  ref = git("rev-list", "-n", "1", latest.tag);
}
const version = parts.slice(0, 3).join(".") + (channel === "preview" ? `-preview.${parts[3]}` : "");
const previous = (channel === "preview" ? previews : productions).filter(release => compare(release.parts, parts) < 0).at(-1)?.tag ?? "";

console.log([
  `channel=${channel}`,
  `version=${version}`,
  `tag=v${version}`,
  `name=${channel === "preview" ? "Couch Preview" : "Couch"} ${version}`,
  `ref=${ref}`,
  `previous_tag=${previous}`,
  `skip=${skip}`,
].join("\n"));
