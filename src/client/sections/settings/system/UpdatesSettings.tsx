import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiSend, type ApiCredentials } from "@/api/client";
import { updatesQuery } from "@/api/settings";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { TRY_AGAIN } from "@/copy";
import { readUpdateRequest, saveUpdateRequest, clearUpdateRequest } from "../../../update-request";
import { verificationFailure, type UpdateState } from "../../../../shared/updates";

type Props = { credentials: ApiCredentials; connected: boolean; target?: "this app" | "selected host"; hostName?: string };
type UpdateResult = Partial<UpdateState> & { accepted?: boolean; transaction?: NonNullable<UpdateState["installation"]>["transaction"] };
const statuses: Record<UpdateState["status"], string> = { unavailable: "Updates unavailable", idle: "Up to date", checking: "Checking…", available: "Update available", downloading: "Downloading…", ready: "Ready to install", failed: "Update failed" };
const terminal = ["succeeded", "failed", "restored", "operator-required"];
const megabytes = (progress: { received: number; total: number }) => `${Math.floor(progress.received / 1024 / 1024)} / ${Math.ceil(progress.total / 1024 / 1024)} MB`;
const appRecovery = "Reinstall Couch from its installer. Your data stays.";

export function UpdatesSettings({ credentials, connected, target = "selected host", hostName = "Couch" }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(() => readUpdateRequest(credentials.origin));
  const [confirming, setConfirming] = useState<false | "install" | "repair">(false);
  const [interrupt, setInterrupt] = useState(false);
  const query = updatesQuery(credentials, retry?.requestId);
  const updates = useQuery({ ...query, enabled: connected || !!retry, placeholderData: keepPreviousData });
  const state = updates.data ?? null;
  const mutation = useMutation({ mutationFn: ({ path, body }: { path: string; body: unknown }) => apiSend<UpdateResult>(credentials, `/api/updates/${path}`, body) });
  const pending = mutation.isPending;
  useEffect(() => {
    const transaction = updates.data?.installation?.requestedTransaction ?? updates.data?.installation?.transaction;
    if (transaction && retry?.requestId === transaction.requestId && terminal.includes(transaction.phase)) {
      clearUpdateRequest(credentials.origin); setRetry(null);
    }
  }, [credentials.origin, retry?.requestId, updates.data]);
  async function update(path: string, body: unknown) {
    const maintenanceRequest = path === "install" || path === "repair";
    if ((!connected && !maintenanceRequest) || pending) return;
    setError(null);
    try {
      const result = await mutation.mutateAsync({ path, body });
      if (maintenanceRequest) {
        const transaction = result.transaction;
        if (transaction && transaction.requestId === retry?.requestId && terminal.includes(transaction.phase)) { clearUpdateRequest(credentials.origin); setRetry(null); }
        queryClient.setQueryData(query.queryKey, current => current ? { ...current, installation: { enabled: true, transaction: transaction ?? null } } : current);
      }
      else queryClient.setQueryData(query.queryKey, result as UpdateState);
      await updates.refetch();
    } catch (reason) {
      if (!(reason instanceof ApiError)) { setError("Lost connection. Reconnect to check."); return; }
      if (maintenanceRequest && reason.body.accepted === false) { clearUpdateRequest(credentials.origin); setRetry(null); }
      setError(reason.message || "Couldn't start the update. Try again.");
    }
  }
  const transaction = state?.installation?.transaction;
  const installing = !!transaction && !terminal.includes(transaction.phase);
  const install = async () => {
    try {
      const current = state?.installation?.current;
      const saved = retry ?? (confirming === "repair" && current ? saveUpdateRequest(credentials.origin, { id: current.candidateId, version: current.version, revision: current.revision }, interrupt, "repair-current") : state?.candidate ? saveUpdateRequest(credentials.origin, state.candidate, interrupt) : null);
      if (!saved) return;
      setRetry(saved); setConfirming(false);
      const { candidateId, requestId, confirmInterrupt } = saved;
      if (saved.intent === "repair-current") await update("repair", { repair: { expectedCurrentId: candidateId, requestId, confirmInterrupt, repairRuntime: saved.repairRuntime } });
      else await update("install", { install: { candidateId, requestId, confirmInterrupt } });
    } catch { setError("Allow site storage, then try again."); }
  };
  const downloadAgain = async () => {
    clearUpdateRequest(credentials.origin); setRetry(null);
    if (state?.candidate) await update("stage", { candidateId: state.candidate.id });
  };
  if (!connected && !retry && !transaction) return null;
  const ownApp = target === "this app";
  const problem = error ?? (updates.error ? "Couldn't check for updates." : null);
  const busy = !connected || pending || installing || !!retry || !state || state.status === "checking" || state.status === "downloading";
  const candidate = state?.candidate;
  const fresh = !!candidate && (candidate.expiresAt === undefined || candidate.expiresAt > Date.now());
  const signingKeyMismatch = state?.error?.includes("The signature was created with a different key than the one provided");
  const canStage = state?.currentCheck && fresh && state.status !== "ready" && !signingKeyMismatch;
  const canInstall = !busy && state?.installation?.enabled && state.currentCheck && state.status === "ready" && fresh;
  const phase = transaction?.phase;
  const phaseText = transaction && !installing ? null : phase === "accepted" ? "Starting…" : phase === "preflight" ? "Checking space…" : phase === "quiescing" ? "Waiting for playback to stop…" : phase === "installing" ? "Installing…" : phase === "trial" || phase === "committing" ? "Restarting. This page reconnects." : phase === "restoring" ? "Restoring the previous version…" : "Waiting…";
  const repair = transaction?.intent === "repair-current";
  const outcome = phase === "succeeded" ? state?.running.version === transaction!.version && state.running.revision === transaction!.revision ? repair ? "Repaired" : "Installed" : "Installed. Restart to finish."
    : phase === "restored" ? repair ? "Repair failed. Restored previous version" : "Restored previous version"
    : phase === "operator-required" ? ownApp ? "Needs repair" : "Needs repair over SSH"
    : phase === "failed" ? repair ? "Repair stopped" : "Update stopped"
    : repair ? "Repairing" : "Updating Couch";
  const waiting = !!state && (state.status === "checking" || state.status === "downloading");
  const checked = state?.lastSuccessfulCheck ? `Checked ${new Date(state.lastSuccessfulCheck).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Never checked";
  const current = state?.installation?.current;
  const canRepair = !!state?.installation?.enabled && !!state.installation.repairAvailable && !!current && !retry && !installing;

  return <>
    {state && <SettingsSection>
      <SettingsRow label="Version" description={state.running.revision ?? undefined}><span className="text-sm">{state.running.version}</span></SettingsRow>
      {state.status !== "unavailable" && <>
      <SettingsRow label="Channel" htmlFor="release-channel">
        <Select value={state.channel} disabled={busy} onValueChange={value => void update("channel", { channel: value })}>
          <SelectTrigger id="release-channel" className="w-40"><SelectValue>{state.channel === "stable" ? "Stable" : "Preview"}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="stable">Stable</SelectItem><SelectItem value="preview">Preview</SelectItem></SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow label="Install updates" htmlFor="update-policy" description={state.policy === "idle" ? state.waiting || "Installs when idle." : undefined}>
        <Select value={state.policy} disabled={busy} onValueChange={value => void update("policy", { policy: value })}>
          <SelectTrigger id="update-policy" className="w-40"><SelectValue>{state.policy === "idle" ? "Auto when idle" : "Manual"}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="manual">Manual</SelectItem><SelectItem value="idle" disabled={!state.installation?.enabled}>Auto when idle</SelectItem></SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow label={<span role="status" className="flex items-center gap-2">{waiting && <Spinner />}{state.status === "idle" && !state.currentCheck ? "Not checked yet" : statuses[state.status]}</span>}
        description={state.status === "downloading" && state.progress ? `${megabytes(state.progress)} downloaded` : checked}>
        <Button variant="outline" disabled={busy} onClick={() => void update("check", { check: true })}>Check for updates</Button>
        {candidate && state.status !== "ready" && <Button disabled={busy || !canStage} onClick={() => void update("stage", { candidateId: candidate.id })}>Download</Button>}
        {!retry && !installing && state.status === "ready" && <Button disabled={!canInstall} onClick={() => setConfirming("install")}>Install</Button>}
      </SettingsRow>
      </>}
      {state.error && <Alert variant={state.status === "unavailable" ? "default" : "destructive"}><AlertDescription>{signingKeyMismatch
        ? `${ownApp ? "This computer" : hostName} can't verify the update's signing key. Reinstall Couch${ownApp ? "" : ` on ${hostName}`} from the official installer. Your data stays.`
        : ownApp && state.status === "unavailable" ? "Update with the Couch installer. Your data stays." : state.error}</AlertDescription></Alert>}
      {candidate && <SettingsRow label={state.currentCheck ? "New version" : "Last seen version"} description={<span className="whitespace-pre-wrap">{candidate.notes}</span>}><span className="break-all text-sm">{candidate.version}</span></SettingsRow>}
      {canRepair && <SettingsRow label="Repair" description={`Reinstall ${current.version}. Your data stays.`}>
        <Button variant="outline" disabled={busy} onClick={() => setConfirming("repair")}>Repair</Button>
      </SettingsRow>}
      {state.installationUnavailable && <Alert><AlertDescription>{state.installationUnavailable}</AlertDescription></Alert>}
      {!state.installationUnavailable && !state.installation?.enabled && state.status !== "unavailable" && <Alert><AlertDescription>{ownApp ? appRecovery : `In-app updates are off. Install the new package on ${hostName}.`}</AlertDescription></Alert>}
    </SettingsSection>}
    {!state && !problem && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading…</p>}
    {(retry || transaction) && <SettingsSection title={outcome}>
      <div role="status" className="flex flex-col gap-1 text-sm">
        <p>{phase === "restored" ? transaction!.restoredVersion : transaction?.version || retry?.version}</p>
        {phaseText && <p className="flex items-center gap-2 text-muted-foreground">{installing && <Spinner />}{phaseText}</p>}
        {transaction?.progress && <p className="text-muted-foreground">{megabytes(transaction.progress)}</p>}
        {!connected && <p className="text-muted-foreground">Restarting. Keep this page open.</p>}
        {phase === "operator-required" && <p className="text-muted-foreground">{ownApp ? appRecovery : "Check the Couch journal over SSH. Keep the data folder."}</p>}
      </div>
      {transaction?.error && <Alert variant="destructive"><AlertDescription>{transaction.error}</AlertDescription></Alert>}
      {!installing && candidate && verificationFailure(transaction?.error) && <div><Button disabled={pending} onClick={() => void downloadAgain()}>Download again</Button></div>}
      {retry && (!transaction || !installing && transaction.requestId !== retry.requestId) && <div><Button disabled={pending} onClick={() => void install()}>{TRY_AGAIN}</Button></div>}
    </SettingsSection>}
    {problem && <Alert variant="destructive"><AlertDescription>{problem}</AlertDescription><AlertAction>{verificationFailure(problem) && candidate
      ? <Button variant="outline" size="sm" disabled={pending} onClick={() => void downloadAgain()}>Download again</Button>
      : <Button variant="outline" size="sm" disabled={pending} onClick={() => { setError(null); void updates.refetch(); }}>{TRY_AGAIN}</Button>}</AlertAction></Alert>}
    <AlertDialog open={!!confirming && !retry && !installing} onOpenChange={open => { if (!open) setConfirming(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirming === "repair" ? `Repair ${current?.version}?` : `Install ${candidate?.version}?`}</AlertDialogTitle>
          <AlertDialogDescription>{hostName} restarts and remotes briefly disconnect.</AlertDialogDescription>
        </AlertDialogHeader>
        <Field orientation="horizontal"><Checkbox id="update-interrupt" checked={interrupt} onCheckedChange={checked => setInterrupt(checked === true)} /><FieldLabel htmlFor="update-interrupt" className="font-normal">Stop playback if needed</FieldLabel></Field>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={confirming === "repair" ? busy : !canInstall} onClick={() => void install()}>{confirming === "repair" ? "Repair and restart" : "Install and restart"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
