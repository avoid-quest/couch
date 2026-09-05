import { version } from "../../package.json";

// The release builder replaces this value in the compiled coordinator.
export const buildInfo = JSON.parse(process.env.COUCH_BUILD_INFO ?? JSON.stringify({ version, revision: null, target: null, packaged: false }));
