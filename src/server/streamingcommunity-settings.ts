import { validStreamingCommunityOrigin } from "../shared/streamingcommunity";
import type { ControllerIdentity } from "../shared/controllers";
import { ControllerError, settingField } from "./controllers";
import type { Store } from "./store";

export function createStreamingCommunitySettings(store: Store) {
  return { async handle(request: Request, identity: () => ControllerIdentity | null) {
    const authorize = () => {
      const caller = identity();
      if (!caller) throw new ControllerError("Pair this device before connecting.", 401);
      if (caller.authority === "controller") throw new ControllerError("An administrator is required to manage website sources.", 403);
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
      return json({ error: error instanceof ControllerError ? error.message : "Could not save the website origin. Check the TV's storage and try again." }, error instanceof ControllerError ? error.status : 500);
    }
  } };
}
