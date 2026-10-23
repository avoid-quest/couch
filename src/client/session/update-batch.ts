import { isUpdateVersion, type UpdateState } from "../../shared/updates";

export type UpdateBatch = {
  items: Array<{ id: string; name: string; version: string; status: "waiting" | "installing" | "updated" | "failed"; error?: string; startedAt?: number }>;
  helperError?: string;
  helpers: "waiting" | "checking" | "updated" | "skipped" | "failed";
  helperStartedAt?: number;
  helperCheckedAt?: number | null;
  createdAt: number;
  interrupt?: boolean;
};

export const batchLifetime = 30 * 60 * 1_000;
export const restartTimeout = 5 * 60 * 1_000;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const rank = (id: string) => id === "app" ? 2 : id === "host" ? 1 : 0;

export function createUpdateBatch(targets: Array<{ id: string; name: string; state?: UpdateState }>, ids: string[], helpers: boolean, interrupt = false, now = Date.now()): UpdateBatch {
  const selected = new Set(ids);
  for (const id of selected) {
    const target = targets.find(target => target.id === id);
    if (!target?.state || target.state.status !== "ready" || !target.state.available) throw new Error(`${target?.name ?? "The selected app"} isn't ready to update. Reconnect and check again.`);
  }
  return { createdAt: now, interrupt, helpers: helpers ? "waiting" : "updated", items: targets
    .filter(target => selected.delete(target.id) && target.state?.status === "ready" && target.state.available)
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map(target => ({ id: target.id, name: target.name, version: target.state!.available!, status: "waiting" })) };
}

export const updateBatchKey = (origin: string, installation: string, viewer: string) => `couch.update-batch:${JSON.stringify([origin, installation, viewer])}`;
const helpersFinished = (batch: UpdateBatch) => batch.helpers === "updated" || batch.helpers === "skipped";
export const batchActive = (batch: UpdateBatch | null) => !!batch && batch.helpers !== "failed" && !batch.items.some(item => item.status === "failed")
  && (!helpersFinished(batch) || batch.items.some(item => item.status === "waiting" || item.status === "installing"));

/** A saved install is observed, never resent. Invalid or expired intent cannot restart a device. */
export function restoreUpdateBatch(text: string | null, now = Date.now()): UpdateBatch | null {
  try {
    const value = JSON.parse(text ?? "null") as UpdateBatch | null;
    if (!value || !Number.isFinite(value.createdAt) || value.createdAt > now
      || !["waiting", "checking", "updated", "skipped", "failed"].includes(value.helpers)
      || value.interrupt !== undefined && typeof value.interrupt !== "boolean"
      || value.helperError !== undefined && typeof value.helperError !== "string"
      || value.helperStartedAt !== undefined && !Number.isFinite(value.helperStartedAt)
      || value.helperCheckedAt !== undefined && value.helperCheckedAt !== null && !Number.isFinite(value.helperCheckedAt)
      || value.helpers === "checking" && value.helperStartedAt === undefined
      || !Array.isArray(value.items) || value.items.length > 128) return null;
    const ids = new Set<string>();
    for (const item of value.items) {
      if (!item || typeof item.id !== "string" || !item.id || item.id.length > 100 || ids.has(item.id)
        || typeof item.name !== "string" || item.name.length > 200 || !isUpdateVersion(item.version)
        || !["waiting", "installing", "updated", "failed"].includes(item.status)
        || item.error !== undefined && typeof item.error !== "string"
        || item.startedAt !== undefined && !Number.isFinite(item.startedAt)
        || item.status === "installing" && item.startedAt === undefined) return null;
      ids.add(item.id);
    }
    // Preserve the planned order; rejecting edited ordering is safer than reordering an active install.
    if (value.items.some((item, index) => index > 0 && rank(item.id) < rank(value.items[index - 1]!.id))) return null;
    // Restart intent expires; the provider retires success and keeps failures for retry.
    if (now - value.createdAt > batchLifetime && batchActive(value)) return null;
    return value;
  } catch { return null; }
}

export function saveUpdateBatch(storage: Pick<Storage, "setItem" | "getItem">, key: string, batch: UpdateBatch) {
  try {
    const text = JSON.stringify(batch);
    storage.setItem(key, text);
    if (storage.getItem(key) !== text) throw new Error("Storage did not retain the update.");
  } catch { throw new Error("Couldn't save update progress. Allow local storage before restarting Couch apps."); }
}

type BatchItem = UpdateBatch["items"][number];
type BatchActions = {
  save(batch: UpdateBatch): void;
  changed(batch: UpdateBatch): void;
  helpers(resume: boolean, startedAt: number): Promise<void>;
  install(item: BatchItem, interrupt: boolean): Promise<void>;
  confirm(item: BatchItem): Promise<void>;
  signal: AbortSignal;
  now?: () => number;
};

/** Helpers, connected apps, the server, then this window's app. Only confirmation advances the batch. */
export async function runUpdateBatch(initial: UpdateBatch, actions: BatchActions) {
  let batch = initial;
  let active: string | undefined;
  const now = actions.now ?? Date.now;
  const save = (next: UpdateBatch) => {
    actions.signal.throwIfAborted();
    actions.save(next);
    batch = next;
    actions.changed(batch);
  };
  const itemState = (id: string, patch: Partial<BatchItem>) => ({ ...batch, items: batch.items.map(item => item.id === id ? { ...item, ...patch } : item) });
  const fresh = () => { if (now() - batch.createdAt > batchLifetime) throw new Error("The update request expired. Review the remaining apps before restarting them."); };
  if (!batchActive(batch)) return;
  try {
    if (!helpersFinished(batch)) {
      fresh();
      const resume = batch.helpers === "checking";
      save({ ...batch, helpers: "checking", helperStartedAt: batch.helperStartedAt ?? now() });
      await actions.helpers(resume, batch.helperStartedAt!);
      save({ ...batch, helpers: "updated", helperError: undefined });
    }
    for (const planned of batch.items) {
      if (planned.status === "updated") continue;
      if (planned.status === "failed") return;
      active = planned.id;
      if (planned.status === "waiting") {
        fresh();
        save(itemState(planned.id, { status: "installing", startedAt: now(), error: undefined }));
        await actions.install(batch.items.find(item => item.id === active)!, batch.interrupt === true);
      }
      actions.signal.throwIfAborted();
      await actions.confirm(batch.items.find(item => item.id === active)!);
      save(itemState(planned.id, { status: "updated", error: undefined }));
    }
  } catch (error) {
    if (actions.signal.aborted) return;
    const failed = active ? itemState(active, { status: "failed", error: message(error) })
      : { ...batch, helpers: "failed" as const, helperError: message(error) };
    // Never continue after a failed checkpoint, even if storage stopped working mid-batch.
    try { actions.save(failed); } catch { /* The in-memory failure still stops this run. */ }
    actions.changed(failed);
    return error;
  }
}
