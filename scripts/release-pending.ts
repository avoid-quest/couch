/** Exit 0 when the package.json version still needs a preview release; exit 1 when the tag or the preview feed already has it. */
import { application, cdn, releaseVersion } from "./hosted-policy";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function releasePending(version: string, lookups: { tagExists: (tag: string) => Promise<boolean>; feedVersion: () => Promise<string | null> }) {
  releaseVersion(version);
  const tag = `v${version}`;
  if (await lookups.tagExists(tag)) return { pending: false, reason: `${tag} already exists` };
  const feed = await lookups.feedVersion();
  if (feed !== null && Bun.semver.order(version, feed) <= 0) return { pending: false, reason: `the preview feed already serves ${feed}` };
  return { pending: true, reason: feed ? `the preview feed serves ${feed}` : "the preview feed is empty" };
}

async function tagExists(tag: string) {
  const lookup = Bun.spawnSync(["gh", "api", `repos/${process.env.GITHUB_REPOSITORY}/git/ref/tags/${tag}`], { stdout: "ignore", stderr: "ignore" });
  return lookup.exitCode === 0;
}

async function feedVersion() {
  try {
    const response = await fetch(`${cdn}/update/${application}/linux-x86_64-deb/0.0.0?channel=preview`, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return null;
    const latest = (await response.json()) as { version?: unknown };
    return typeof latest.version === "string" ? latest.version : null;
  } catch { return null; }
}

if (import.meta.main) {
  const version = releaseVersion((await Bun.file("package.json").json()).version);
  const { pending, reason } = await releasePending(version, { tagExists, feedVersion });
  console.log(`${version}: ${reason}.`);
  process.exit(pending ? 0 : 1);
}
