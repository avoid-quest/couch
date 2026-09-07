import type { ControllerIdentity } from "../shared/controllers";
import type { DisplayAction, DisplayState } from "../shared/display";
import { ControllerError, settingField } from "./controllers";

export async function displaySettings(request: Request, identity: () => ControllerIdentity | null, invoke?: (action: DisplayAction) => Promise<DisplayState>) {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  const authorize = () => {
    const caller = identity();
    if (!caller) throw new ControllerError("Pair this remote before connecting.", 401);
    if (caller.authority !== "administrator") throw new ControllerError("An administrator is required.", 403);
  };
  try {
    authorize();
    const path = new URL(request.url).pathname;
    let action: DisplayAction;
    if (path === "/api/display" && request.method === "GET") action = { op: "read" };
    else if (["/api/display/preview", "/api/display/confirm", "/api/display/cancel"].includes(path) && request.method === "POST") {
      const preview = path.endsWith("/preview");
      const value = await settingField(request, preview ? "output" : "token");
      if (typeof value !== "string" || !value.length || value.length > 4200) throw new ControllerError("Choose a current screen or preview.", 400);
      action = preview ? { op: "preview", output: value } : { op: path.endsWith("/confirm") ? "confirm" : "cancel", token: value };
    } else return json({ error: "Not found." }, 404);
    authorize();
    if (!invoke) return json({ error: "Display selection requires the native Ubuntu appliance." }, 503);
    return json(await invoke(action));
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Display selection failed." }, error instanceof ControllerError ? error.status : 503); }
}
