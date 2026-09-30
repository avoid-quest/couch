import type { UpdateAction, UpdateState, UpdateTarget } from "../shared/app-bridge";
import { isDeviceId, type DeviceIdentity } from "../shared/devices";
import { ControllerError, settingField } from "./devices";
import { ADMIN_ONLY } from "./messages";

export async function updateSettings(request: Request, identity: () => DeviceIdentity | null, invoke?: (action: UpdateAction, device: string) => Promise<UpdateState>, targets: () => UpdateTarget[] = () => []) {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  const authorize = () => {
    const caller = identity();
    if (!caller) throw new ControllerError("Pair this device first.", 401);
    if (caller.authority === "controller") throw new ControllerError(ADMIN_ONLY, 403);
  };
  try {
    authorize();
    const url = new URL(request.url), path = url.pathname;
    if (path === "/api/updates/targets" && request.method === "GET") return json(targets());
    const device = url.searchParams.get("device") ?? "host";
    if (device !== "host" && !isDeviceId(device)) throw new ControllerError("Choose a connected Couch app.", 400);
    let action: UpdateAction;
    if (path === "/api/updates" && request.method === "GET") action = { op: "read" };
    else if (path === "/api/updates/check" && request.method === "POST") action = { op: "check" };
    else if (path === "/api/updates/channel" && request.method === "POST") {
      const channel = await settingField(request, "channel");
      if (channel !== "latest" && channel !== "preview") throw new ControllerError("Choose Stable or Preview.", 400);
      action = { op: "channel", channel };
    } else if (path === "/api/updates/install" && request.method === "POST") {
      const version = await settingField(request, "version");
      if (typeof version !== "string" || version.length > 80 || !/^\d+\.\d+\.\d+(-preview\.\d+)?$/.test(version)) throw new ControllerError("Choose the available update.", 400);
      action = { op: "install", version };
    } else return json({ error: "Not found." }, 404);
    authorize();
    if (!invoke) return json({ error: "Updates are available in the installed Couch app." }, 503);
    return json(await invoke(action, device));
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Couldn't update Couch." }, error instanceof ControllerError ? error.status : 503); }
}
