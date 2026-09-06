/** CI attempts are distinct Debian versions; promotion never changes this identity. */
export function releaseVersion(version: string, releaseId?: string) {
  if (!releaseId) return version;
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[1-9]\d*\.[1-9]\d*$/.test(releaseId)) throw new Error("Release identity requires a plain product version and positive run.attempt");
  return `${version}+build.${releaseId}`;
}
