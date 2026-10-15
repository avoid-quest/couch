import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { LanNetwork } from "./lan-listener";
import type { LocalRelayState, LiveRelay } from "../shared/live-relay";

async function startRelay(executable: string, network: LanNetwork, failed: () => void) {
  const username = randomBytes(16).toString("base64url"), credential = randomBytes(32).toString("base64url");
  const child = spawn(executable, [], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  let expected = false;
  const exited = new Promise<void>(resolve => child.once("close", () => { if (!expected) failed(); resolve(); }));
  const stop = async () => {
    expected = true;
    child.stdin.end();
    const kill = setTimeout(() => child.kill("SIGKILL"), 2000);
    try { await exited; } finally { clearTimeout(kill); }
  };
  child.stdin.on("error", () => {});
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("The bundled relay did not start in time.")), 5000);
      let output = "";
      const finish = (error?: Error, port?: number) => { clearTimeout(timeout); error ? reject(error) : resolve(port!); };
      child.once("error", () => finish(new Error("The bundled relay could not be launched. Reinstall this Couch build.")));
      child.once("exit", () => finish(new Error("The bundled relay could not listen on this network.")));
      child.stdout.on("data", data => {
        output += String(data);
        if (output.length > 1024) { finish(new Error("The bundled relay returned an invalid response.")); return; }
        if (!output.includes("\n")) return;
        try {
          const { port } = JSON.parse(output.split("\n")[0]!);
          if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
          finish(undefined, port);
        } catch { finish(new Error("The bundled relay returned an invalid response.")); }
      });
      child.stdin.write(`${JSON.stringify({ address: network.address, netmask: network.netmask, username, credential })}\n`);
    });
    if (child.exitCode !== null) throw new Error("The bundled relay stopped.");
    return { relay: { urls: `turn:${network.address}:${port}?transport=tcp`, username, credential } satisfies LiveRelay, stop };
  } catch (error) { await stop(); throw error; }
}

// One helper follows the selected LAN listener, never an independent service.
export function createLocalRelay(options: { executable?: string; enabled: boolean; changed: () => void }) {
  let enabled = options.enabled, closed = false, network: LanNetwork | null = null;
  let active: Awaited<ReturnType<typeof startRelay>> | null = null;
  let activeNetwork = "", error: string | null = null, starting = false;
  let generation = 0, activeGeneration = 0;
  let pending = Promise.resolve();
  const state = (): LocalRelayState => {
    const current = !closed && enabled && activeGeneration === generation && activeNetwork === JSON.stringify(network) ? active : null;
    return { enabled, status: !enabled ? "off" : error ? "error" : starting ? "starting" : current ? "running" : "waiting", error, relay: current?.relay ?? null };
  };
  const reconcile = () => pending = pending.catch(() => {}).then(async () => {
    if (active && (closed || !enabled || !network || JSON.stringify(network) !== activeNetwork || activeGeneration !== generation)) { const previous = active; active = null; options.changed(); await previous.stop(); }
    error = null;
    if (closed || !enabled || !network) { options.changed(); return; }
    if (active) return;
    const key = JSON.stringify(network), nextGeneration = generation;
    starting = true; options.changed();
    try {
      if (!options.executable) throw new Error("The relay is not included in this Couch build.");
      active = await startRelay(options.executable, network, () => {
        if (!active || closed) return;
        active = null; error = "The bundled relay stopped. Turn it off and on to retry."; options.changed();
      });
      activeNetwork = key;
      activeGeneration = nextGeneration;
    } catch (reason) { error = reason instanceof Error ? reason.message : "The bundled relay could not start."; }
    finally { starting = false; options.changed(); }
  });
  return {
    state,
    async setEnabled(value: boolean) { enabled = value; await reconcile(); },
    async setNetwork(value: LanNetwork | null) { network = value; await reconcile(); },
    // Cached credentials and allocations belong to the helper's generation, not a device.
    // Hide it synchronously, including an in-flight start, then await its replacement.
    async revoke() { generation++; options.changed(); await reconcile(); },
    async close() { closed = true; await reconcile(); },
  };
}
