import { useCallback, useEffect, useState } from "react";
import { CircleDot, Play, RefreshCw, Settings2, X } from "lucide-react";
import type { ControllerIdentity } from "../../shared/controllers";
import type { GuideChannel, GuideProgram } from "../../shared/iptv";
import type { Recording, RecordingsPage } from "../../shared/recordings";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RecordingSettings } from "./RecordingSettings";

export type RecordingRequest = (path: string, init?: RequestInit) => Promise<Response>;
export function useRecordings({ origin, token, connected, active, version }: { origin: string; token: string; connected: boolean; active: boolean; version: number }) {
  const [page, setPage] = useState<RecordingsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const request = useCallback<RecordingRequest>(async (path, init = {}) => {
    // Setup can make fourteen sequential eight-second backend requests, plus
    // legacy intent cleanup. Scheduling and cancellation also need several.
    const timeout = init.method === "POST" ? path === "setup" ? 180_000 : path === "schedule" ? 90_000 : path.endsWith("/cancel") ? 60_000 : 30_000 : 30_000;
    const response = await fetch(`${origin}/api/recordings${path ? `/${path}` : ""}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(timeout)]) });
    if (!response.ok) { const value = await response.json().catch(() => ({})); throw new Error(value.error || "Could not complete the recording request."); }
    return response;
  }, [origin, token]);
  const reload = useCallback(() => setRefresh(value => value + 1), []);
  useEffect(() => { setPage(null); setError(null); }, [origin, token]);
  useEffect(() => {
    if (!connected || !active) return;
    const controller = new AbortController();
    setError(null);
    void request("", { signal: controller.signal }).then(response => response.json() as Promise<RecordingsPage>).then(value => { if (!controller.signal.aborted) { setPage(value); setError(null); } }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [request, connected, active, version, refresh]);
  return { page, error, request, reload };
}
const statusText = { checking: "Checking backend", pending: "Pending", running: "Recording", completed: "Completed", failed: "Failed", cancelled: "Cancelled" };
const range = (job: Pick<GuideProgram, "start" | "end">) => {
  const start = new Date(job.start), end = new Date(job.end);
  return `${start.toLocaleString()} – ${end.toLocaleString([], { ...(start.toDateString() === end.toDateString() ? {} : { year: "numeric", month: "numeric", day: "numeric" }), hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`;
};
export function RecordingsPanel({ remote, channels, connected, canPlay, host, origin, token, controllerVersion }: {
  remote: ReturnType<typeof useRecordings>; channels: GuideChannel[]; connected: boolean; canPlay: boolean; host: boolean; origin: string; token: string; controllerVersion: number;
}) {
  const [open, setOpen] = useState(false); const [settings, setSettings] = useState(false);
  const [identity, setIdentity] = useState<ControllerIdentity | null>(null);
  const [pending, setPending] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState("");
  const administrator = identity?.authority === "host" || identity?.authority === "administrator";
  useEffect(() => {
    setIdentity(null);
    if (!connected || !open) return;
    const controller = new AbortController();
    void fetch(`${origin}/api/controllers/me`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }).then(response => response.json() as Promise<ControllerIdentity>).then(value => { if (!controller.signal.aborted) setIdentity(value); }).catch(() => {});
    return () => controller.abort();
  }, [origin, token, connected, open, controllerVersion]);
  useEffect(() => { if (!administrator) setSettings(false); }, [administrator]);
  async function mutate(action: "refresh" | "cancel" | "play", job?: Recording) {
    setPending(job?.id ?? "refresh"); setError(null); setNotice("");
    try {
      await remote.request(job ? `${job.id}/${action}` : action, { method: "POST", ...(action === "cancel" ? { body: JSON.stringify({ revision: job!.revision }) } : {}) });
      remote.reload(); setNotice(action === "play" ? `Starting ${job!.title} on the TV.` : action === "cancel" ? "Cancellation requested. The current backend state is shown below." : "Backend state refreshed.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update recordings."); remote.reload(); }
    finally { setPending(null); }
  }
  return <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) { setSettings(false); setError(null); setNotice(""); } }}>
    <DialogTrigger asChild><Button variant="outline"><CircleDot aria-hidden="true" />Recordings</Button></DialogTrigger>
    <DialogContent data-tv-local-only={host && settings || undefined}>
      <DialogHeader><DialogTitle>Recordings</DialogTitle><DialogDescription>Schedule future programmes from the guide. Completed recordings play on the TV.</DialogDescription></DialogHeader>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!connected || !!pending} onClick={() => remote.page?.configured && !remote.error ? void mutate("refresh") : remote.reload()}><RefreshCw aria-hidden="true" />{remote.error || !remote.page ? "Retry recordings" : "Refresh status"}</Button>{administrator && <Button variant="outline" data-tv-local-only={host || undefined} disabled={!connected || !!pending} onClick={() => setSettings(value => !value)}><Settings2 aria-hidden="true" />{settings ? "Back to recordings" : "Recording setup"}</Button>}</div>
      {(error || remote.error || remote.page?.error) && <Alert variant="destructive"><AlertDescription>{error || remote.error || remote.page?.error}</AlertDescription></Alert>}
      {!connected && <p className="text-sm text-muted-foreground">This remote is offline. Showing saved status; recording controls are unavailable.</p>}
      {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
      {settings && administrator ? <div data-tv-local-only={host || undefined}><RecordingSettings request={remote.request} channels={channels} connected={connected} onUpdated={remote.reload} /></div> : <>
        <p className="text-xs text-muted-foreground">{remote.page?.checkedAt ? `Last checked ${new Date(remote.page.checkedAt).toLocaleString()}.` : "Backend state has not been checked since Couch restarted."}</p>
        {!remote.page ? <p>{remote.error ? "Retry loading recordings when the connection is available." : "Loading recordings…"}</p> : !remote.page.configured ? <p className="text-sm text-muted-foreground">An administrator can connect Tvheadend and map guide channels in Recording setup.</p> : !remote.page.jobs.length ? <p className="text-sm text-muted-foreground">No recordings yet. Open a channel's Programs and record a future programme.</p> : <ul className="space-y-3">{remote.page.jobs.map(job => <li key={job.id} className="space-y-2 rounded-lg border p-3" data-recording-id={job.id}>
          <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="min-w-0 break-words font-medium">{job.title}</h3><Badge variant={job.status === "failed" ? "destructive" : "secondary"}>{statusText[job.status]}</Badge></div>
          <p className="break-words text-sm text-muted-foreground">{job.channelName}<br />{range(job)}</p>
          {job.cause && <p className="text-sm text-destructive">{job.cause}</p>}
          {job.status === "checking" && <p className="text-sm text-muted-foreground">Couch is reconciling the saved request. Refresh status before trying again.</p>}
          <div className="flex flex-wrap gap-2">{job.status === "completed" && <Button disabled={!connected || !canPlay || !!pending} onClick={() => void mutate("play", job)}><Play aria-hidden="true" />Play on TV</Button>}{job.status === "pending" && <Button variant="outline" disabled={!connected || !!pending} onClick={() => void mutate("cancel", job)}><X aria-hidden="true" />{job.cancelRequested ? "Retry pending cancellation" : "Cancel pending recording"}</Button>}</div>
        </li>)}</ul>}
      </>}
    </DialogContent>
  </Dialog>;
}
