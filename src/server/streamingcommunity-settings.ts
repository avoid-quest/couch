import { validStreamingCommunityOrigin } from "../shared/streamingcommunity";
import type { DeviceIdentity } from "../shared/devices";
import { ControllerError, settingField } from "./devices";
import type { Store } from "./store";
import { ADMIN_ONLY, STORAGE_ERROR } from "./messages";

export function createStreamingCommunitySettings(store: Store) {
  return { async handle(request: Request, identity: () => DeviceIdentity | null) {
    const authorize = () => {
      const caller = identity();
      if (!caller) throw new ControllerError("Pair this device first.", 401);
      if (caller.authority === "controller") throw new ControllerError(ADMIN_ONLY, 403);
    };
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
    try {
      authorize();
      if (request.method === "POST") {
        const origin = await settingField(request, "origin");
        authorize();
        if (!validStreamingCommunityOrigin(origin)) throw new ControllerError("Enter the current StreamingCommunity HTTPS origin, without a path, query or credentials.");
        store.saveStreamingCommunityOrigin(origin);
      } else if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
      return json({ origin: store.streamingCommunityOrigin() });
    } catch (error) {
      return json({ error: error instanceof ControllerError ? error.message : STORAGE_ERROR("the site address") }, error instanceof ControllerError ? error.status : 500);
    }
  } };
}
