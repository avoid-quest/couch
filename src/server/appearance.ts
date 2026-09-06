import { isInterfaceSize, type TvAppearance } from "../shared/appearance";
import type { ControllerIdentity } from "../shared/controllers";
import { ControllerError, settingField } from "./controllers";
import type { Store } from "./store";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createAppearance(store: Store, publish: (appearance: TvAppearance) => void) {
  let preview: { size: TvAppearance["size"]; id: string; expiresAt: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const state = (): TvAppearance => ({
    size: preview?.size ?? store.tvInterfaceSize(), confirmedSize: store.tvInterfaceSize(),
    preview: preview ? { id: preview.id, expiresAt: preview.expiresAt } : null,
  });
  const cancel = () => { clearTimeout(timer); preview = null; publish(state()); };

  return {
    async handle(request: Request, identity: () => ControllerIdentity | null) {
      const authorize = () => {
        const caller = identity();
        if (!caller) throw new ControllerError("Pair this device before connecting.", 401);
        if (request.method !== "GET" && caller.authority === "controller") throw new ControllerError("An administrator is required.", 403);
      };
      try {
        authorize();
        if (preview && preview.expiresAt <= Date.now()) cancel();
        const path = new URL(request.url).pathname;
        if (path === "/api/appearance" && request.method === "GET") return json(state());
        if (!["/api/appearance", "/api/appearance/confirm", "/api/appearance/cancel", "/api/appearance/reset"].includes(path)) return json({ error: "Not found." }, 404);
        if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: path === "/api/appearance" ? "GET, POST" : "POST" } });
        const confirmation = path.endsWith("/confirm") || path.endsWith("/cancel");
        const value = await settingField(request, confirmation ? "previewId" : "size");
        authorize();
        if (confirmation) {
          if (typeof value !== "string" || !preview || preview.id !== value || preview.expiresAt <= Date.now()) throw new ControllerError("This preview has ended. Choose a size to try again.", 409);
          if (path.endsWith("/confirm")) store.saveTvInterfaceSize(preview.size);
          cancel();
        } else {
          if (!isInterfaceSize(value) || path.endsWith("/reset") && value !== 1) throw new ControllerError("Choose a supported interface size.");
          if (path.endsWith("/reset")) { store.saveTvInterfaceSize(1); cancel(); }
          else {
            clearTimeout(timer);
            preview = { size: value, id: crypto.randomUUID(), expiresAt: Date.now() + 20_000 };
            timer = setTimeout(cancel, 20_000);
            publish(state());
          }
        }
        return json(state());
      } catch (error) {
        return json({ error: error instanceof ControllerError ? error.message : "Could not save TV interface size. Check the TV's storage and try again." }, error instanceof ControllerError ? error.status : 500);
      }
    },
    close() { clearTimeout(timer); },
  };
}
