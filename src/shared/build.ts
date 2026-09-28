import { version } from "../../package.json";

declare const COUCH_BUILD_INFO: string;

// The release builder embeds the same identity in the native host, coordinator
// and both frontend bundles. No installed file or browser supplies this value.
export const buildInfo = JSON.parse(typeof COUCH_BUILD_INFO === "undefined" ? JSON.stringify({ version, revision: null, dataFormat: 1, packaged: false }) : COUCH_BUILD_INFO);
export const loadedBuild = { version: buildInfo.version, revision: buildInfo.revision, dataFormat: buildInfo.dataFormat };
export function buildKey(build: { version: string; revision: string | null; dataFormat: number }) {
  return build.revision ? `${build.version}:${build.revision}:${build.dataFormat}` : null;
}

