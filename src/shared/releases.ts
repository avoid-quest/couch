export type ReleaseNotes = { version: string; publishedAt: string; url: string; items: string[] };
export type ReleaseHistory = { releases: ReleaseNotes[]; more: boolean };

/** Couch releases use x.y.z or x.y.z-preview.n; stable follows its previews. */
export function compareUpdateVersions(a: string, b: string) {
  const parts = (value: string) => value.split(/\.|-preview\./).map(Number);
  const left = parts(a), right = parts(b);
  for (let i = 0; i < 3; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return difference;
  }
  if (left[3] === undefined) return right[3] === undefined ? 0 : 1;
  return right[3] === undefined ? -1 : left[3] - right[3];
}
