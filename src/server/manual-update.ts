import type { ControllerIdentity } from "../shared/controllers";
import type { UpdateTransaction } from "../shared/updates";
import { ControllerError, settingField } from "./controllers";
import type { createUpdaterClient } from "./updater-client";

type Worker = Pick<ReturnType<typeof createUpdaterClient>, "request">;
const finished = new Set(["succeeded", "failed", "restored"]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createManualUpdate(worker: Worker, admitted: () => boolean, candidateReady: (id: string) => boolean) {
  let busy = false;
  const authorize = (identity: () => ControllerIdentity | null) => {
    const caller = identity();
    if (!caller) throw new ControllerError("Pair this device before connecting.", 401);
    if (caller.authority !== "administrator") throw new ControllerError("An administrator remote is required to install updates.", 403);
  };
  const status = async (requestId?: string) => {
    const result = await worker.request({ op: "status", ...(requestId ? { requestId } : {}) }) as { ok?: boolean; transaction?: UpdateTransaction | null };
    if (result?.ok !== true || result.transaction === undefined) throw new ControllerError("The external update worker is unavailable. Check its service through SSH.", 503);
    if (!requestId) busy = !!result.transaction && !finished.has(result.transaction.phase);
    return result.transaction;
  };
  return {
    busy: () => busy,
    async read(identity: () => ControllerIdentity | null, requestId?: string) {
      authorize(identity);
      if (requestId !== undefined && !/^[a-f0-9]{32}$/.test(requestId)) throw new ControllerError("Use the saved update request identity.");
      const transaction = await status();
      const requestedTransaction = requestId ? await status(requestId) : undefined;
      authorize(identity);
      return { enabled: true, transaction, ...(requestId ? { requestedTransaction } : {}) };
    },
    async install(request: Request, identity: () => ControllerIdentity | null) {
      let unaccepted = false;
      try {
        authorize(identity);
        const body = await settingField(request, "install") as { candidateId: string; requestId: string; confirmInterrupt: boolean };
        if (!body || typeof body !== "object" || Object.keys(body).sort().join(",") !== "candidateId,confirmInterrupt,requestId" || typeof body.candidateId !== "string" || !/^[a-f0-9]{64}$/.test(body.candidateId) || typeof body.requestId !== "string" || !/^[a-f0-9]{32}$/.test(body.requestId) || typeof body.confirmInterrupt !== "boolean") throw new ControllerError("Choose the verified candidate and confirm whether playback may stop.");
        authorize(identity);
        const previous = await status(body.requestId);
        authorize(identity);
        if (!previous && (!admitted() || busy || !candidateReady(body.candidateId))) {
          unaccepted = admitted() && !busy;
          throw new ControllerError("Use a current verified download after the active operation finishes.", 409);
        }
        // Retries still reach the worker, which checks every field against its
        // durable receipt. No browser path, command or release URL is accepted.
        busy = true;
        const result = await worker.request({ op: "install", ...body }) as { ok?: boolean; transaction?: UpdateTransaction; error?: string };
        authorize(identity);
        if (result?.ok !== true || !result.transaction) throw new ControllerError(result?.error || "The worker could not accept this update. Refresh its status.", 409);
        busy = !finished.has(result.transaction.phase);
        return json({ transaction: result.transaction }, 202);
      } catch (error) {
        return json({ error: error instanceof ControllerError ? error.message : "The update request did not finish. Refresh status before retrying.", ...(unaccepted ? { accepted: false } : {}) }, error instanceof ControllerError ? error.status : 400);
      }
    },
  };
}
