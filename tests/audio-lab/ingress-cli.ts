// Bundle with Bun target=node, then execute with Node (Couch uses node:sqlite).
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { openStore } from "../../src/server/store";
import { startIngressLab, type IngressOptions } from "./ingress-server";

const config = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as Omit<IngressOptions, "store"> & { databasePath: string };
// Optional tls.certFile/keyFile are the scratch Core's PEM paths; forward them
// with the exact page-origin allowlist, independently of the listener's URL.
const store = openStore(config.databasePath);
const lab = await startIngressLab({ ...config, store });
const reply = (message: unknown) => process.stdout.write(`COUCH_INGRESS ${JSON.stringify(message)}\n`);
reply({ ready: true, origin: lab.origin });
let closing = false;
async function close() { if (closing) return; closing = true; await lab.close(); store.close(); }
createInterface({ input: process.stdin }).on("line", async line => {
  let id: unknown;
  try {
    const request = JSON.parse(line); id = request.id;
    if (request.close) { await close(); process.exit(0); }
    if (request.stop) lab.stop();
    reply({ id, value: lab.snapshot() });
  } catch (error) { reply({ id, error: String(error) }); }
});
process.stdin.on("end", () => { void close(); });
process.once("SIGTERM", () => { void close().then(() => process.exit(0)); });
process.once("SIGINT", () => { void close().then(() => process.exit(130)); });
