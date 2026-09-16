/** Print the CHANGELOG.md section for the current version as dispatch release notes. */
import { releaseVersion } from "./hosted-policy";

export function releaseNotes(version: string, changelog: string | null) {
  releaseVersion(version);
  if (!changelog) return `Release ${version}`;
  const section = changelog.match(new RegExp(`(?:^|\\n)## ${escapeRegExp(version)}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`))?.[1]?.trim();
  return section || `Release ${version}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (import.meta.main) {
  const version = releaseVersion((await Bun.file("package.json").json()).version);
  const file = Bun.file("CHANGELOG.md");
  const changelog = await file.exists() ? await file.text() : null;
  console.log(releaseNotes(version, changelog));
}
