/** Print the CHANGELOG.md section for the current version as dispatch release notes. */
import { releaseVersion } from "./hosted-policy";

export function releaseNotes(version: string, changelog: string | null) {
  releaseVersion(version);
  if (!changelog) return `Release ${version}`;
  const section = changelog
    .match(
      new RegExp(
        `(?:^|\\n)## ${escapeRegExp(version)}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`,
      ),
    )?.[1]
    ?.trim();
  return section || `Release ${version}`;
}

/** Read a version and its notes from one commit, even after the branch moves. */
export async function releaseNotesAtRevision(
  revision: string,
  directory = ".",
) {
  const read = async (path: string) => {
    const child = Bun.spawn(["git", "show", `${revision}:${path}`], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [text, code] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    if (code !== 0 && path === "package.json")
      throw new Error(`Cannot read package.json at ${revision}`);
    return code === 0 ? text : null;
  };
  const [pkg, changelog] = await Promise.all([
    read("package.json"),
    read("CHANGELOG.md"),
  ]);
  return releaseNotes(releaseVersion(JSON.parse(pkg!).version), changelog);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (import.meta.main) {
  const [revision] = process.argv.slice(2);
  console.log(
    revision
      ? await releaseNotesAtRevision(revision)
      : releaseNotes(
          releaseVersion((await Bun.file("package.json").json()).version),
          (await Bun.file("CHANGELOG.md").exists())
            ? await Bun.file("CHANGELOG.md").text()
            : null,
        ),
  );
}
