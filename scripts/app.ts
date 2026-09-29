import electron from "electron";

// Runs the Couch app from this checkout (`bun run app` builds first). Its data
// defaults to .data; set COUCH_DATA_DIR and COUCH_PORT for other scratch runs.
// Some shells export ELECTRON_RUN_AS_NODE, which would start Electron as plain Node.
const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
const child = Bun.spawn([electron as unknown as string, ".", ...process.argv.slice(2)], { env, stdio: ["inherit", "inherit", "inherit"] });
process.exit(await child.exited);
