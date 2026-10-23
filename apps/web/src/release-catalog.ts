import fallback from "./releases.json";

// The public repo the app publishes to and updates from (package.json build.publish).
const repo = "avoid-quest/couch";
export type Channel = "stable" | "preview";
export const formats = ["dmg", "dmg-intel", "nsis", "appimage", "deb"] as const;
export type PackageFormat = (typeof formats)[number];
// How electron-builder ends each installer's name.
const suffixes: Record<PackageFormat, string> = { dmg: "-arm64.dmg", "dmg-intel": "-x64.dmg", nsis: "-x64.exe", appimage: "-x86_64.AppImage", deb: "_amd64.deb" };
export type Release = { version: string; url: string; filename: string };
export type Catalog = Record<Channel, Partial<Record<PackageFormat, Release>>>;
type GitHubRelease = { tag_name: string; prerelease: boolean; assets: { name: string; browser_download_url: string }[] };

function installers(release: GitHubRelease | undefined): Catalog[Channel] {
  if (!release) return {};
  const version = release.tag_name.replace(/^v/, "");
  return Object.fromEntries(formats.flatMap(format => release.assets.filter(asset => asset.name.endsWith(suffixes[format]))
    .map(asset => [format, { version, filename: asset.name, url: asset.browser_download_url }])));
}

// GitHub requires a user agent. Cloudflare keeps each answer for five minutes,
// which keeps the Worker under GitHub's unauthenticated rate limit.
async function github(path: string) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, { headers: { "user-agent": "couch.avoid.quest" }, signal: AbortSignal.timeout(10_000), cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit);
  if (response.status === 404) return undefined; // No production release yet.
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return response.json();
}

// As t3code's site does: `releases/latest` is the production release and skips
// pre-releases, so the preview is the newest pre-release in the list. If GitHub
// can't answer, the page offers the installers in releases.json.
export async function currentCatalog(): Promise<Catalog> {
  try {
    const [latest, list] = await Promise.all([github("releases/latest"), github("releases?per_page=10")]);
    return { stable: installers(latest), preview: installers((list as GitHubRelease[]).find(release => release.prerelease)) };
  } catch {
    return fallback;
  }
}
