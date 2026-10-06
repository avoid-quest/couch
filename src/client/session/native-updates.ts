import type { CouchApp } from "../../shared/app-bridge";
import { validateUpdateAction, type UpdateAction, type UpdateState } from "../../shared/updates";

/** Prefer the guarded action bridge, with a preflight for older installed apps. */
export async function updateApp(app: Pick<CouchApp, "update" | "updates" | "checkForUpdates" | "setUpdateChannel" | "installUpdate">, action: UpdateAction): Promise<UpdateState> {
  validateUpdateAction(action);
  if (app.update) return app.update(action);
  if (action.op === "read") return app.updates();
  if (action.op === "check") return app.checkForUpdates();
  if (action.op === "channel") return app.setUpdateChannel(action.channel);
  const current = await app.updates();
  if (current.status !== "ready" || current.available !== action.version) throw new Error("The available update changed. Check again.");
  await app.installUpdate(action.version);
  return { ...current, status: "installing", error: null };
}
