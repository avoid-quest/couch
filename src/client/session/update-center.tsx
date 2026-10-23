import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HelperUpdates } from "../../shared/helper-updates";
import { UPDATE_INTERRUPTS_PLAYBACK, type UpdateAction, type UpdateChannel, type UpdateState, type UpdateTarget } from "../../shared/updates";
import { ApiError, apiJson, apiSend } from "../api/client";
import { deviceId, useLocalDeviceName } from "./device-id";
import { couchApp } from "./native-context";
import { updateApp } from "./native-updates";
import { notice } from "../toasts";
import { errorText, useSessionGate } from "./session-context";
import { batchActive, batchLifetime, createUpdateBatch, restartTimeout, restoreUpdateBatch, runUpdateBatch, saveUpdateBatch, updateBatchKey, type UpdateBatch } from "./update-batch";

export type { UpdateBatch } from "./update-batch";
export type UpdateCenterTarget = { id: string; name: string; tv: boolean; local: boolean; state?: UpdateState; error?: string };
export type UpdateCenterValue = {
  targets: UpdateCenterTarget[];
  // An admin of the connected server: its media tools run with every update.
  canMaintain: boolean;
  helpers?: HelperUpdates;
  helperError?: string;
  batch: UpdateBatch | null;
  busy: boolean;
  checking: boolean;
  checkFailed: boolean;
  check(): Promise<void>;
  update(ids: string[], interrupt?: boolean): Promise<void>;
  setChannel(id: string, channel: UpdateChannel): Promise<void>;
};

const UpdateCenterContext = createContext<UpdateCenterValue | null>(null);

export function useUpdateCenter() {
  const value = useContext(UpdateCenterContext);
  if (!value) throw new Error("useUpdateCenter must be used inside UpdateCenterProvider.");
  return value;
}

export function UpdateCenterProvider({ children }: PropsWithChildren) {
  const { credentials, details, identity } = useSessionGate();
  const origin = credentials?.origin ?? (typeof location === "undefined" ? "" : location.origin);
  const installation = credentials?.installationId ?? details?.installationId ?? `local:${deviceId()}`;
  const storageKey = updateBatchKey(origin, installation, deviceId());
  // Retire requests and in-memory results when the authenticated owner changes.
  return <UpdateCenterSession key={`${storageKey}:${credentials?.token ?? ""}:${identity?.authority ?? ""}`} storageKey={storageKey}>{children}</UpdateCenterSession>;
}

const activeState = (state?: UpdateState) => !!state && ["checking", "downloading", "installing"].includes(state.status);
const interval = 1_500;
const idleInterval = 30_000;
const suffix = (id: string) => `?device=${encodeURIComponent(id)}`;
const interruption = (error: unknown) => error instanceof Error && (error.message === UPDATE_INTERRUPTS_PLAYBACK
  || error instanceof ApiError && error.status === 409 && error.body.interruptionRequired === true);
const pause = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted();
  const aborted = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", aborted); resolve(); }, interval);
  signal.addEventListener("abort", aborted, { once: true });
});

function UpdateCenterSession({ children, storageKey }: PropsWithChildren<{ storageKey: string }>) {
  const { credentials, identity, localHost, connected, details } = useSessionGate();
  const canMaintain = !!credentials && (identity?.authority === "host" || identity?.authority === "administrator");
  const client = useQueryClient();
  const name = useLocalDeviceName();
  const [local, setLocal] = useState<UpdateState>();
  const [localError, setLocalError] = useState<string>();
  const [actionErrors, setActionErrors] = useState<Record<string, string | undefined>>({});
  const [helperActionError, setHelperActionError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [batch, setBatch] = useState<UpdateBatch | null>(() => {
    try { return restoreUpdateBatch(localStorage.getItem(storageKey)); } catch { return null; }
  });
  const batchRef = useRef(batch);
  const runner = useRef(false);
  const checkingRef = useRef(false);
  const lifetime = useRef(new AbortController());
  const localRevision = useRef(0);
  const active = batchActive(batch);
  const clearActionError = (id: string, next: UpdateState) => {
    if (!next.error && next.status !== "error") setActionErrors(errors => errors[id] ? { ...errors, [id]: undefined } : errors);
  };
  const updateBatch = (next: UpdateBatch | null) => { batchRef.current = next; setBatch(next); };
  const clearBatch = () => {
    try { localStorage.removeItem(storageKey); } catch { /* Retire the result in this tab even if storage became unavailable. */ }
    updateBatch(null);
  };
  useEffect(() => {
    lifetime.current = new AbortController();
    return () => lifetime.current.abort();
  }, []);

  useEffect(() => {
    if (!couchApp?.updates) return;
    let disposed = false;
    const receive = (next: UpdateState) => { localRevision.current++; setLocal(next); setLocalError(undefined); clearActionError("app", next); };
    const unsubscribe = couchApp.onUpdates(receive);
    const revision = localRevision.current;
    void couchApp.updates().then(next => {
      if (!disposed && revision === localRevision.current) receive(next);
    }, error => { if (!disposed && revision === localRevision.current) setLocalError(errorText(error)); });
    return () => { disposed = true; unsubscribe(); };
  }, []);

  const discovery = useQuery({ queryKey: ["updates", "targets"], enabled: canMaintain && connected,
    queryFn: ({ signal }) => apiJson<UpdateTarget[]>(credentials!, "/api/updates/targets", { signal }),
    refetchInterval: active ? interval : idleInterval, retry: false });
  const remote = canMaintain ? (discovery.data ?? (details?.updates ? [{ id: "host", name: details.name, tv: !!details.tvPresentation }] : []))
    .filter(target => !couchApp?.updates || target.id !== identity?.device?.id && !(target.id === "host" && localHost)) : [];
  for (const item of batch?.items ?? []) {
    if (canMaintain && item.id !== "app" && !remote.some(target => target.id === item.id) && item.status !== "updated") remote.push({ id: item.id, name: item.name, tv: false });
  }
  const reads = useQueries({ queries: remote.map(target => ({ queryKey: ["updates", target.id], enabled: connected,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const next = await apiJson<UpdateState>(credentials!, `/api/updates${suffix(target.id)}`, { signal });
      clearActionError(target.id, next);
      return next;
    },
    refetchInterval: (query: { state: { data: unknown } }) => active || activeState(query.state.data as UpdateState | undefined) ? interval : idleInterval, retry: false })) });
  const helperQuery = useQuery({ queryKey: ["updates", "helpers"], enabled: canMaintain && connected,
    queryFn: ({ signal }) => apiJson<HelperUpdates>(credentials!, "/api/updates/helpers", { signal }),
    refetchInterval: query => active || query.state.data?.status === "checking" ? interval : idleInterval, retry: false });
  const targets: UpdateCenterTarget[] = [
    ...(couchApp?.updates ? [{ id: "app", name: name ?? "This app", tv: couchApp.tvPresentation, local: true, state: local, error: actionErrors.app ?? localError }] : []),
    ...remote.map((target, index) => ({ ...target, local: false, state: reads[index]?.data,
      error: actionErrors[target.id] ?? (reads[index]?.error ? errorText(reads[index]!.error) : discovery.error ? errorText(discovery.error) : undefined) })),
  ];

  const localAction = async (action: UpdateAction) => {
    const revision = localRevision.current;
    const next = await updateApp(couchApp!, action);
    if (!lifetime.current.signal.aborted && revision === localRevision.current) { localRevision.current++; setLocal(next); setLocalError(undefined); clearActionError("app", next); }
    return next;
  };
  const read = async (id: string, signal: AbortSignal) => {
    signal.throwIfAborted();
    const next = id === "app" ? await localAction({ op: "read" })
      : await apiJson<UpdateState>(credentials!, `/api/updates${suffix(id)}`, { signal });
    signal.throwIfAborted();
    if (id !== "app") client.setQueryData(["updates", id], next);
    clearActionError(id, next);
    return next;
  };
  const helpers = async (resume: boolean, startedAt: number, previousCheck: number | null | undefined, signal: AbortSignal) => {
    if (!canMaintain) throw new Error("Only an admin can update this Couch's media tools.");
    let next = resume ? await apiJson<HelperUpdates>(credentials!, "/api/updates/helpers", { signal })
      : await apiSend<HelperUpdates>(credentials!, "/api/updates/helpers/check");
    while (true) {
      signal.throwIfAborted();
      client.setQueryData(["updates", "helpers"], next);
      if (next.status === "done") {
        if (resume && (previousCheck === undefined || next.checkedAt === null || next.checkedAt === previousCheck)) throw new Error("Couldn't confirm media tool maintenance. Check again before restarting Couch.");
        const errors = next.items.filter(item => item.status === "error").map(item => `${item.name}: ${item.error ?? "Update failed"}`);
        if (errors.length) throw new Error(errors.join("; "));
        return;
      }
      if (next.status !== "checking") throw new Error("Media tool maintenance was interrupted. Check again before restarting Couch.");
      if (Date.now() - startedAt > batchLifetime) throw new Error("Media tools are still updating. Check again before restarting Couch.");
      await pause(signal);
      next = await apiJson<HelperUpdates>(credentials!, "/api/updates/helpers", { signal });
    }
  };
  const execute = async (initial: UpdateBatch) => {
    if (runner.current) return;
    runner.current = true;
    setRunning(true);
    const signal = lifetime.current.signal;
    try {
      const error = await runUpdateBatch(initial, {
        signal, save: next => saveUpdateBatch(localStorage, storageKey, next), changed: updateBatch,
        helpers: (resume, startedAt) => helpers(resume, startedAt, initial.helperCheckedAt, signal),
        install: async (item, interrupt) => {
          const current = await read(item.id, signal);
          if (current.version === item.version) return;
          if (current.status !== "ready" || current.available !== item.version) throw new Error("The available update changed. Check again.");
          try {
            const next = item.id === "app" ? await localAction({ op: "install", version: item.version, interrupt })
              : await apiSend<UpdateState>(credentials!, `/api/updates/install${suffix(item.id)}${interrupt ? "&interrupt=1" : ""}`, { version: item.version });
            if (next.error) throw new Error(next.error);
          } catch (error) {
            // A lost HTTP connection may be the restart. Keep observing; a server rejection is final.
            if (item.id === "app" || error instanceof ApiError || !(error instanceof TypeError || error instanceof DOMException)) throw error;
          }
        },
        confirm: async item => {
          // A resumed page can already be past the timeout while the app has successfully restarted.
          while (true) {
            let next: UpdateState | undefined;
            try { next = await read(item.id, signal); }
            catch (error) { if (signal.aborted || error instanceof ApiError && [401, 403].includes(error.status)) throw error; }
            if (next?.version === item.version) return;
            if (next?.error) throw new Error(next.error);
            const last = next?.automatic?.last;
            if (last && last.at >= item.startedAt! && ["failed", "rolled-back"].includes(last.outcome)) throw new Error(last.error ?? `Couch ${item.version} did not start.`);
            if (Date.now() - item.startedAt! >= restartTimeout) break;
            await pause(signal);
          }
          throw new Error(`Couldn't confirm Couch ${item.version} after restarting. Reconnect and check before retrying.`);
        },
      });
      if (interruption(error)) throw error;
      if (!error && !signal.aborted) {
        clearBatch();
        const message = initial.items.length === 1 ? `Updated ${initial.items[0]!.name}` : initial.items.length ? `Updated ${initial.items.length} devices` : "Media tools updated";
        notice(initial.helpers === "skipped" ? `${message}. Media tools weren’t checked.` : message);
      }
    } finally { runner.current = false; if (!lifetime.current.signal.aborted) setRunning(false); }
  };

  useEffect(() => {
    if (runner.current) return;
    if (!batchActive(batch)) {
      // Earlier builds retained completed results indefinitely. Retire them quietly, without repeating a toast.
      if (batch && batch.helpers !== "failed" && !batch.items.some(item => item.status === "failed")) clearBatch();
      return;
    }
    const needsServer = !["updated", "skipped"].includes(batch!.helpers) || batch!.items.some(item => item.id !== "app" && item.status !== "updated");
    if (needsServer && identity && !canMaintain) {
      const stopped: UpdateBatch = { ...batch!, helpers: "failed", helperError: "Only an admin can finish updating these devices." };
      try { saveUpdateBatch(localStorage, storageKey, stopped); } catch { /* The in-memory failure still stops this run. */ }
      updateBatch(stopped);
      return;
    }
    if (needsServer && (!canMaintain || !connected)) return;
    void execute(batch!).catch(() => {}); // Restored failures are shown in the retained batch.
  }, [batch, canMaintain, connected, running]);

  const check = async () => {
    if (checkingRef.current || runner.current || active) return;
    clearBatch();
    checkingRef.current = true; setChecking(true); setHelperActionError(undefined);
    const signal = lifetime.current.signal, startedAt = Date.now();
    const states: UpdateState[] = [];
    let failed = false;
    try {
      await Promise.all([
        ...targets.map(async target => {
          try {
            let next: UpdateState;
            if (target.local) next = await localAction({ op: "check" });
            else {
              next = await apiSend<UpdateState>(credentials!, `/api/updates/check${suffix(target.id)}`);
              signal.throwIfAborted();
              client.setQueryData(["updates", target.id], next);
              setActionErrors(errors => ({ ...errors, [target.id]: undefined }));
            }
            while (activeState(next)) {
              if (Date.now() - startedAt > batchLifetime) throw new Error("Still checking for updates. Try again later.");
              await pause(signal);
              next = await read(target.id, signal);
            }
            states.push(next);
            if (next.error || next.status === "error") { failed = true; setActionErrors(errors => ({ ...errors, [target.id]: next.error ?? "Couldn't check for updates." })); }
          } catch (error) { failed = true; setActionErrors(errors => ({ ...errors, [target.id]: errorText(error) })); }
        }),
        ...(canMaintain ? [helpers(false, startedAt, undefined, signal).catch(error => { failed = true; setHelperActionError(errorText(error)); })] : []),
      ]);
      if (!failed && !signal.aborted) {
        const tools = canMaintain && client.getQueryData<HelperUpdates>(["updates", "helpers"]);
        if (tools && tools.items.some(item => item.status === "updated")) notice("Media tools updated");
        else if (states.every(state => state.status === "up-to-date")) notice("Everything is up to date");
      }
    } finally { checkingRef.current = false; setChecking(false); }
  };
  const update = async (ids: string[], interrupt = false) => {
    if (runner.current || checkingRef.current || batchActive(batchRef.current)) return;
    setHelperActionError(undefined);
    const next = createUpdateBatch(targets, ids, canMaintain, interrupt);
    if (!next.items.length && next.helpers === "updated") return;
    checkingRef.current = true;
    try {
      if (canMaintain) {
        try {
          const before = await apiJson<HelperUpdates>(credentials!, "/api/updates/helpers", { signal: lifetime.current.signal });
          next.helperCheckedAt = before.checkedAt;
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
          const unsupported = "This Couch version doesn't support media tool maintenance. Update its app, then check the tools again.";
          if (!next.items.length) throw new Error(unsupported);
          next.helpers = "skipped";
          next.helperError = unsupported;
        }
      }
      saveUpdateBatch(localStorage, storageKey, next);
    }
    catch (error) {
      updateBatch({ ...next, helpers: "failed", helperError: errorText(error) });
      throw error;
    } finally { checkingRef.current = false; }
    updateBatch(next);
    await execute(next);
  };
  const setChannel = async (id: string, channel: UpdateChannel) => {
    if (runner.current || active || checkingRef.current) return;
    clearBatch();
    if (id === "app") await localAction({ op: "channel", channel });
    else {
      if (!canMaintain || !targets.some(target => target.id === id)) throw new Error("Choose a connected Couch app.");
      const next = await apiSend<UpdateState>(credentials!, `/api/updates/channel${suffix(id)}`, { channel });
      client.setQueryData(["updates", id], next);
    }
  };
  const value: UpdateCenterValue = { targets, canMaintain, helpers: canMaintain ? helperQuery.data : undefined,
    helperError: helperActionError ?? (helperQuery.error ? errorText(helperQuery.error) : undefined), batch,
    busy: running || active, checking: checking || targets.some(target => activeState(target.state)) || helperQuery.data?.status === "checking",
    checkFailed: !!helperActionError || Object.values(actionErrors).some(Boolean),
    check, update, setChannel };
  return <UpdateCenterContext.Provider value={value}>{children}</UpdateCenterContext.Provider>;
}
