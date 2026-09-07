import { version } from "../../package.json";

// The release builder embeds the same identity in the native host, coordinator
// and both frontend bundles. No installed file or browser supplies this value.
export const buildInfo = JSON.parse(process.env.COUCH_BUILD_INFO ?? JSON.stringify({ version, revision: null, dataFormat: 1, target: null, packaged: false }));
export const loadedBuild = { version: buildInfo.version, revision: buildInfo.revision, dataFormat: buildInfo.dataFormat };
export function buildKey(build: { version: string; revision: string | null; dataFormat: number }) {
  return build.revision ? `${build.version}:${build.revision}:${build.dataFormat}` : null;
}

export type MaintenanceBuild = { version: string; revision: string; dataFormat: number };
