import type { DeviceIdentity } from "../shared/devices";
import type { BluetoothAction, BluetoothState } from "../shared/bluetooth";
import { ControllerError, settingField } from "./devices";
import { ADMIN_ONLY } from "./messages";

export async function bluetoothSettings(request: Request, identity: () => DeviceIdentity | null, invoke?: (action: BluetoothAction) => Promise<BluetoothState>) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const authorize = () => {
    const caller = identity();
    if (!caller) throw new ControllerError("Pair this device first.", 401);
    if (caller.authority === "controller" || caller.authority === "administrator" && !caller.device) throw new ControllerError(ADMIN_ONLY, 403);
    return caller.authority === "host" ? "host" : caller.device!.id;
  };
  try {
    const owner = authorize();
    const path = new URL(request.url).pathname;
    let action: BluetoothAction;
    if (path === "/api/bluetooth" && request.method === "GET") action = { op: "read", owner };
    else if (path === "/api/bluetooth" && request.method === "POST") {
      const value = await settingField(request, "action");
      authorize();
      if (!value || typeof value !== "object" || !("op" in value)) throw new ControllerError("Choose a Bluetooth action.", 400);
      const input = value as Record<string, unknown>;
      if (!["scan", "power", "pair", "connect", "disconnect", "forget", "cancel"].includes(String(input.op))) throw new ControllerError("Unknown Bluetooth action.", 400);
      action = { op: input.op as BluetoothAction["op"], owner };
      for (const field of ["device", "token"] as const) {
        if (input[field] !== undefined) {
          if (typeof input[field] !== "string" || input[field].length > 64) throw new ControllerError("Invalid Bluetooth request.", 400);
          action[field] = input[field];
        }
      }
      if (["pair", "connect", "disconnect", "forget"].includes(action.op) && !/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(action.device ?? "")) throw new ControllerError("Choose a current Bluetooth device.", 400);
    } else return json({ error: "Not found." }, 404);
    if (!invoke) return json({ error: "Bluetooth isn't available on this Couch." }, 503);
    const result = await invoke(action);
    // A revoked administrator cannot retain a pending agent or discovery lease.
    try { authorize(); } catch (error) { void invoke({ op: "cancel", owner }).catch(() => {}); throw error; }
    return json(result);
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Bluetooth did not answer." }, error instanceof ControllerError ? error.status : 503); }
}
