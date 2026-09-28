import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import type { BluetoothAction, BluetoothOperation, BluetoothState } from "../shared/bluetooth";

// Linux Bluetooth through BlueZ's own CLI. Pairing registers a NoInputNoOutput
// agent, which accepts the Just Works pairing that speakers and headphones use.
const limit = 60_000;
const run = (args: string[], timeout: number, signal?: AbortSignal): Promise<string> => new Promise((resolve, reject) => {
  execFile("/usr/bin/bluetoothctl", args, { env: { ...process.env, LC_ALL: "C" }, encoding: "utf8", timeout, signal, maxBuffer: 1024 * 1024, killSignal: "SIGKILL" }, (error, stdout) => {
    const failure = /^.*(?:Failed|not available|No default controller).*$/m.exec(stdout)?.[0]?.trim();
    if (error || failure) reject(new Error(failure ?? (error?.killed ? "Bluetooth didn't answer. Check the bluetooth service." : "The Bluetooth service is unavailable. Check that bluez is installed and running.")));
    else resolve(stdout);
  });
});
const devices = async (filter?: string) => new Set((await run(filter ? ["devices", filter] : ["devices"], 4_000)).matchAll(/^Device ((?:[0-9A-F]{2}:){5}[0-9A-F]{2})/gm).map(match => match[1]!));
const blocked = () => {
  try {
    return readdirSync("/sys/class/rfkill").some(name => readFileSync(`/sys/class/rfkill/${name}/type`, "utf8").trim() === "bluetooth"
      && ["soft", "hard"].some(kind => readFileSync(`/sys/class/rfkill/${name}/${kind}`, "utf8").trim() === "1"));
  } catch { return false; }
};

export function linuxBluetooth() {
  let owner = "";
  let operation: BluetoothOperation | null = null;
  let abort: AbortController | null = null;
  const settle = (id: string, status: BluetoothOperation["status"], message: string | null) => {
    if (operation?.id === id && operation.status === "running") operation = { ...operation, status, message };
  };
  const perform = async (action: BluetoothAction, signal: AbortSignal) => {
    const device = action.device!;
    if (action.op === "power") await run(["power", "on"], 10_000, signal);
    else if (action.op === "scan") await run(["--timeout", "30", "scan", "on"], 35_000, signal).catch(error => { if (!signal.aborted) throw error; });
    else if (action.op === "pair") {
      await run(["--agent", "NoInputNoOutput", "pair", device], limit, signal);
      await run(["trust", device], 10_000, signal);
      await run(["connect", device], limit, signal);
    } else if (action.op === "connect" || action.op === "reconnect") await run(["connect", device], limit, signal);
    else if (action.op === "disconnect") await run(["disconnect", device], 10_000, signal);
    else if (action.op === "forget") await run(["remove", device], 10_000, signal);
    else throw new Error("Unknown Bluetooth action.");
  };
  const inventory = async (): Promise<BluetoothState> => {
    const controller = await run(["show"], 4_000).catch(error => { if (/No default controller/.test(error.message)) return null; throw error; });
    if (!controller) return { adapter: "absent", devices: [], operation };
    const [all, paired, trusted, connected] = await Promise.all([run(["devices"], 4_000), devices("Paired"), devices("Trusted"), devices("Connected")]);
    return {
      adapter: blocked() || /PowerState: off-blocked/.test(controller) ? "blocked" : /Powered: yes/.test(controller) ? "available" : "off",
      devices: [...all.matchAll(/^Device ((?:[0-9A-F]{2}:){5}[0-9A-F]{2}) ?(.*)$/gm)].slice(0, 128).map(([, address, name]) => ({ address: address!, name: (name || address!).slice(0, 160), paired: paired.has(address!), trusted: trusted.has(address!), connected: connected.has(address!) })),
      operation,
    };
  };
  return {
    async request(action: BluetoothAction): Promise<BluetoothState> {
      if (!action.owner || action.owner.length > 128) throw new Error("Invalid Bluetooth owner.");
      if (action.op === "cancel") {
        if (owner === action.owner && (!action.token || operation?.id === action.token)) { abort?.abort(); if (operation) settle(operation.id, "cancelled", "Bluetooth operation cancelled."); }
      } else if (action.op === "answer") throw new Error("This pairing prompt has ended.");
      else if (action.op !== "read") {
        if (operation?.status === "running") throw new Error("Stop the current Bluetooth operation first.");
        const id = action.token ?? crypto.randomUUID();
        const controller = new AbortController();
        owner = action.owner; abort = controller;
        operation = { id, device: action.device ?? null, kind: action.op, status: "running", endsAt: Date.now() + limit, message: null, prompt: null };
        void perform(action, controller.signal).then(() => settle(id, "finished", null), (error: Error) => settle(id, "error", controller.signal.aborted ? "Bluetooth operation cancelled." : error.message));
      }
      return inventory();
    },
    close() { abort?.abort(); },
  };
}
