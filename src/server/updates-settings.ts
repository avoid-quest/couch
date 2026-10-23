import { isUpdateChannel, isUpdateVersion, UPDATE_INTERRUPTS_PLAYBACK, type UpdateAction, type UpdateState, type UpdateTarget } from "../shared/updates";
import type { ReleaseHistory } from "../shared/releases";
import type { HelperUpdates } from "../shared/helper-updates";
import { isDeviceId, type DeviceIdentity } from "../shared/devices";
import { ControllerError, settingField } from "./devices";
import { ADMIN_ONLY } from "./messages";

type Services = {
  helpers?: { read(): Promise<HelperUpdates>; check(): Promise<HelperUpdates> };
  releases?: (channel: "latest" | "preview", page: number) => Promise<ReleaseHistory>;
  playing?: (device: string) => boolean;
};

export async function updateSettings(request: Request, identity: () => DeviceIdentity | null, invoke?: (action: UpdateAction, device: string) => Promise<UpdateState>, targets: () => UpdateTarget[] = () => [], services: Services = {}) {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  const authorize = () => {
    const caller = identity();
    if (!caller) throw new ControllerError("Pair this device first.", 401);
    if (caller.authority === "controller") throw new ControllerError(ADMIN_ONLY, 403);
  };
  try {
    const url = new URL(request.url), path = url.pathname;
    // Release notes are readable by every paired viewer; maintenance remains admin-only.
    if (path === "/api/updates/releases" && request.method === "GET") {
      if (!identity()) throw new ControllerError("Pair this device first.", 401);
      const channel = url.searchParams.get("channel") ?? "latest", page = Number(url.searchParams.get("page") ?? "1");
      if (!isUpdateChannel(channel) || !Number.isInteger(page) || page < 1 || page > 50) throw new ControllerError("Choose a release channel and page.", 400);
      if (!services.releases) throw new ControllerError("Release notes aren't available yet.", 503);
      const history = await services.releases(channel, page);
      if (!identity()) throw new ControllerError("Pair this device first.", 401);
      return json(history);
    }
    authorize();
    if (path === "/api/updates/helpers" && request.method === "GET" || path === "/api/updates/helpers/check" && request.method === "POST") {
      if (!services.helpers) throw new ControllerError("Media tool updates aren't available on this Couch yet.", 503);
      return json(await (request.method === "GET" ? services.helpers.read() : services.helpers.check()));
    }
    if (path === "/api/updates/targets" && request.method === "GET") return json(targets());
    const device = url.searchParams.get("device") ?? "host";
    if (device !== "host" && !isDeviceId(device)) throw new ControllerError("Choose a connected Couch app.", 400);
    let action: UpdateAction;
    if (path === "/api/updates" && request.method === "GET") action = { op: "read" };
    else if (path === "/api/updates/check" && request.method === "POST") action = { op: "check" };
    else if (path === "/api/updates/channel" && request.method === "POST") {
      const channel = await settingField(request, "channel");
      if (!isUpdateChannel(channel)) throw new ControllerError("Choose Stable or Preview.", 400);
      action = { op: "channel", channel };
    } else if (path === "/api/updates/install" && request.method === "POST") {
      const version = await settingField(request, "version");
      if (!isUpdateVersion(version)) throw new ControllerError("Choose the available update.", 400);
      const interrupt = url.searchParams.get("interrupt");
      if (interrupt !== null && interrupt !== "0" && interrupt !== "1") throw new ControllerError("Choose whether to stop playback.", 400);
      action = { op: "install", version, ...(interrupt === "1" && { interrupt: true }) };
    } else return json({ error: "Not found." }, 404);
    authorize();
    if (!invoke) return json({ error: "Updates are available in the installed Couch app." }, 503);
    if (action.op === "install" && !action.interrupt && services.playing?.(device)) throw new ControllerError(UPDATE_INTERRUPTS_PLAYBACK, 409);
    return json(await invoke(action, device));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't update Couch.";
    const interruptionRequired = message === UPDATE_INTERRUPTS_PLAYBACK;
    return json({ error: message, ...(interruptionRequired && { interruptionRequired }) }, interruptionRequired ? 409 : error instanceof ControllerError ? error.status : 503);
  }
}
