import type { ControllerIdentity } from "../shared/controllers";
import type { UpdateState, UpdateTransaction } from "../shared/updates";
import { ControllerError, settingField } from "./controllers";
import type { UpdateRequest } from "../shared/updates";

type Install = { candidateId: string; requestId: string; confirmInterrupt: boolean };
type Repair = { expectedCurrentId: string; requestId: string; confirmInterrupt: boolean; repairRuntime: boolean };
type Worker = { request: (request: UpdateRequest) => Promise<unknown> };
const finished = new Set(["succeeded", "failed", "restored", "operator-required"]);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createManualUpdate(worker: Worker, admitted: () => boolean, candidateReady: (id: string) => boolean, canRepair = () => true) {
  let busy = false;
  let repairAvailable: boolean | null = null;
  let current: NonNullable<UpdateState["installation"]>["current"] = null;
  const authorize = (identity: () => ControllerIdentity | null) => {
    const caller = identity();
    if (!caller) throw new ControllerError("Pair this device before connecting.", 401);
    if (caller.authority !== "administrator") throw new ControllerError("An administrator remote is required to install updates.", 403);
  };
  const status = async (requestId?: string) => {
    const result = await worker.request({ op: "status", ...(requestId ? { requestId } : {}) }) as { ok?: boolean; transaction?: UpdateTransaction | null; current?: typeof current; repairCurrent?: boolean };
    if (result?.ok !== true || result.transaction === undefined) throw new ControllerError("The native updater is unavailable. Check Couch through SSH.", 503);
    current = result.current && /^[a-f0-9]{64}$/.test(result.current.candidateId) && typeof result.current.version === "string" && typeof result.current.revision === "string" ? result.current : null;
    repairAvailable = result.repairCurrent === true;
    if (!requestId) busy = !!result.transaction && !finished.has(result.transaction.phase);
    return result.transaction;
  };
  const submit = async (body: Install | Repair, guard: () => void, whenIdle = false, onUnaccepted = () => {}) => {
    guard();
    const previous = await status(body.requestId);
    guard();
    if (!previous && repairAvailable === false) {
      onUnaccepted();
      throw new ControllerError("AppImage installation is not available. Check the enrolled installation through SSH.", 409);
    }
    const repairing = "expectedCurrentId" in body;
    const ready = repairing ? canRepair() && current?.candidateId === body.expectedCurrentId : candidateReady(body.candidateId);
    if (!previous && (!admitted() || busy || !ready)) {
      if (admitted() && !busy) onUnaccepted();
      throw new ControllerError(repairing ? "Refresh the enrolled current release after the active operation finishes." : "Use a current verified download after the active operation finishes.", 409);
    }
    busy = true;
    const result = await worker.request(repairing ? { op: "repair-current", ...body } : { op: "install", ...body, ...(whenIdle ? { whenIdle: true as const } : {}) }) as { ok?: boolean; transaction?: UpdateTransaction; error?: string };
    guard();
    if (result?.ok !== true || !result.transaction) throw new ControllerError(result?.error || "The worker could not accept this update. Refresh its status.", 409);
    busy = !finished.has(result.transaction.phase);
    return result.transaction;
  };
  async function handle(request: Request, identity: () => ControllerIdentity | null, repairing = false) {
    let unaccepted = false;
    try {
      authorize(identity);
      const body = await settingField(request, repairing ? "repair" : "install") as Install | Repair;
      const id = body && typeof body === "object" && ("expectedCurrentId" in body ? body.expectedCurrentId : body.candidateId);
      const keys = repairing ? "confirmInterrupt,expectedCurrentId,repairRuntime,requestId" : "candidateId,confirmInterrupt,requestId";
      if (!body || typeof body !== "object" || Object.keys(body).sort().join(",") !== keys || typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id) || repairing && typeof (body as Repair).repairRuntime !== "boolean" || typeof body.requestId !== "string" || !/^[a-f0-9]{32}$/.test(body.requestId) || typeof body.confirmInterrupt !== "boolean") throw new ControllerError("Choose the verified candidate and confirm whether playback may stop.");
      authorize(identity);
      const transaction = await submit(body, () => authorize(identity), false, () => { unaccepted = true; });
      return json({ transaction }, 202);
    } catch (error) {
      return json({ error: error instanceof ControllerError ? error.message : "The update request did not finish. Refresh status before retrying.", ...(unaccepted ? { accepted: false } : {}) }, error instanceof ControllerError ? error.status : 400);
    }
  }

  return {
    busy: () => busy,
    needsRefresh: () => repairAvailable === false,
    status,
    automatic: (candidateId: string, requestId: string, guard: () => void) => submit({ candidateId, requestId, confirmInterrupt: false }, guard, true),
    async read(identity: () => ControllerIdentity | null, requestId?: string) {
      authorize(identity);
      if (requestId !== undefined && !/^[a-f0-9]{32}$/.test(requestId)) throw new ControllerError("Use the saved update request identity.");
      const transaction = await status();
      const requestedTransaction = requestId ? await status(requestId) : undefined;
      authorize(identity);
      return { enabled: true, current, repairAvailable: repairAvailable === true, transaction, ...(requestId ? { requestedTransaction } : {}) };
    },
    install: (request: Request, identity: () => ControllerIdentity | null) => handle(request, identity),
    repair: (request: Request, identity: () => ControllerIdentity | null) => handle(request, identity, true),
  };
}
