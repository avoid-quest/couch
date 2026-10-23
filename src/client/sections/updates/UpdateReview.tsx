import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { deviceId } from "@/session/device-id";
import { errorText, useSessionGate } from "@/session/session-context";
import { useUpdateCenter, type UpdateCenterTarget } from "@/session/update-center";
import { UPDATE_INTERRUPTS_PLAYBACK } from "../../../shared/updates";
import type { HelperUpdates } from "../../../shared/helper-updates";
import { ReleaseNotes } from "./ReleaseNotes";
import { updateBusy, updateInterrupts, updateReady, updateStatuses } from "./update-presentation";

const helperStatuses: Record<HelperUpdates["items"][number]["status"], string> = { checking: "Checking…", updated: "Updated", current: "Up to date", compatible: "Compatible", held: "Kept for compatibility", system: "Managed by the system", error: "Update failed" };
const batchStatuses = { waiting: "Waiting", installing: "Updating…", updated: "Updated", failed: "Update failed" };

function MediaTools() {
  const { helpers, helperError, batch } = useUpdateCenter();
  const { state, details } = useSessionGate();
  const [open, setOpen] = useState(false);
  const skipped = batch?.helpers === "skipped";
  return <Collapsible open={open} onOpenChange={setOpen}>
    <CollapsibleTrigger asChild><Button variant="ghost" className="-ml-3 h-auto whitespace-normal text-left">{open ? "Hide media tools" : `Media tools on ${state?.installationName ?? details?.name ?? "this server"}`}{(helpers?.status === "checking" || batch?.helpers === "checking") && <Spinner />}</Button></CollapsibleTrigger>
    <CollapsibleContent className="space-y-3 pt-2 text-sm">
      <p className="text-muted-foreground">Checked on this server before apps restart.</p>
      {helpers?.items.map(item => <div key={item.name} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
        <span>{item.name === "qjs" ? "QuickJS" : item.name === "ffmpeg" ? "FFmpeg" : item.name}{item.version && <span className="ml-2 text-muted-foreground">{item.version}</span>}</span>
        <span className={item.error ? "text-destructive" : "text-muted-foreground"}>{item.error ?? helperStatuses[item.status]}</span>
      </div>)}
      {!helpers && !helperError && <p className="text-muted-foreground">Media tools haven’t been checked yet.</p>}
      {(helperError || batch?.helperError) && <p role={skipped ? "status" : "alert"} className={skipped ? "text-muted-foreground" : "text-destructive"}>{batch?.helperError ?? helperError}</p>}
    </CollapsibleContent>
    {skipped && !open && <p className="text-sm text-muted-foreground">{batch.helperError}</p>}
  </Collapsible>;
}

/** Shared review and progress, mounted in Settings or the notice's dialog. */
export function UpdateReview({ targets, notesOpen = false }: { targets: UpdateCenterTarget[]; notesOpen?: boolean }) {
  const center = useUpdateCenter();
  const { localHost, state } = useSessionGate();
  const includesTools = center.canMaintain;
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState(notesOpen);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string[] | null>(null);
  const [acting, setActing] = useState(false);
  const pending = useRef(false);
  const actions = useRef<HTMLDivElement>(null);
  const id = useId();
  const ready = targets.filter(target => updateReady(target.state));
  // A failed or unfinished device stays ready and selected, so Update retries what remains.
  const selected = ready.filter(target => choices[target.id] !== false).map(target => target.id);
  const disabled = center.busy || acting;

  const update = async (ids: string[], interrupt = false) => {
    if (pending.current) return;
    setError(null);
    if (!interrupt && updateInterrupts(state, ids, deviceId(), localHost)) { setConfirmation(ids); return; }
    setConfirmation(null);
    pending.current = true; setActing(true);
    try { await center.update(ids, interrupt); }
    catch (reason) {
      if (reason instanceof ApiError && reason.body.interruptionRequired === true || errorText(reason) === UPDATE_INTERRUPTS_PLAYBACK) setConfirmation(ids);
      else setError(errorText(reason));
    } finally { pending.current = false; setActing(false); }
  };
  const check = async () => { setError(null); try { await center.check(); } catch (reason) { setError(errorText(reason)); } };
  // Focus moving down the notes and rows stops above the actions, as it does above the footer (--bottom-bar).
  useLayoutEffect(() => {
    const element = actions.current!;
    const observer = new ResizeObserver(() => element.parentElement!.style.setProperty("--update-actions", `${element.offsetHeight}px`));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div className="space-y-6" data-update-review>
    <Collapsible open={notes} onOpenChange={setNotes} className="**:scroll-mb-[calc(var(--update-actions)+.5rem)]">
      {!notesOpen && <CollapsibleTrigger asChild><Button variant="ghost" className="-ml-3">{notes ? "Hide what’s new" : "What’s new"}</Button></CollapsibleTrigger>}
      <CollapsibleContent>{notes && <ReleaseNotes targets={targets} />}</CollapsibleContent>
    </Collapsible>
    <div className={cn("space-y-4 **:scroll-mb-[calc(var(--update-actions)+.5rem)]", notes && "border-t pt-6")}>
      {targets.map(target => {
        const state = target.state;
        const item = center.batch?.items.find(item => item.id === target.id);
        const available = updateReady(state);
        const problem = item?.error ?? target.error ?? state?.error;
        return <div key={target.id} className="space-y-2" data-nav-row>
          <div className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 sm:grid-cols-[1rem_minmax(0,1fr)_auto]">
            <Checkbox id={`${id}-${target.id}`} aria-label={`Update ${target.name}`} checked={available && choices[target.id] !== false} disabled={!available || disabled} className="mt-1" onCheckedChange={checked => { setChoices(previous => ({ ...previous, [target.id]: checked === true })); setConfirmation(null); }} />
            <div className="min-w-0 flex-1">
              <label htmlFor={`${id}-${target.id}`} className="block break-words text-sm font-medium">{target.name}</label>
              <p className="break-words text-sm text-muted-foreground">{state ? `${state.version}${state.available ? ` to ${state.available}` : ""}` : "Waiting for update information…"}</p>
              {problem && <p role="alert" className="mt-1 break-words text-sm text-destructive">{problem}</p>}
            </div>
            {/* A ready row already says so with its versions and checkbox. */}
            <span role="status" className="col-start-2 flex items-center gap-2 text-sm text-muted-foreground empty:hidden sm:col-start-3 sm:row-start-1">
              {(item?.status === "waiting" || item?.status === "installing" || updateBusy(state)) && <Spinner />}
              {item ? batchStatuses[item.status] : state && !available ? updateStatuses[state.status] : ""}
            </span>
          </div>
          {state?.status === "downloading" && state.progress !== null && <Progress value={state.progress} aria-label={`Downloading update for ${target.name}`} className="ml-7 w-[calc(100%-1.75rem)]" />}
        </div>;
      })}
      {/* Retain named results even when the device went offline during its restart. */}
      {center.batch?.items.filter(item => !targets.some(target => target.id === item.id)).map(item => <div key={item.id} className="text-sm"><span>{item.name}</span><span className="ml-3 text-muted-foreground">{batchStatuses[item.status]}</span>{item.error && <p className="break-words text-destructive">{item.error}</p>}</div>)}
      {includesTools && <MediaTools />}
    </div>
    {/* Long notes scroll beneath the actions, which stay above the footer (--bottom-bar) or the dialog's edge. In the
        desktop app the page scrolls inside the shell, which already ends above the footer (index.css). */}
    <div ref={actions} data-nav-footer className="sticky bottom-[var(--bottom-bar,0px)] in-[.electron]:bottom-0 z-10 -mt-3 space-y-3 bg-background py-3 in-data-[slot=dialog-content]:pb-6">
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {confirmation ? <p role="alert" className="text-sm">Updating will stop playback and any screen or sound sharing on the selected apps.</p>
        : selected.length > 0 && <p className="text-sm text-muted-foreground">{targets.some(target => target.local && selected.includes(target.id)) ? "Selected apps restart. This app restarts last." : "Selected apps restart."}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {confirmation ? <>
          <Button disabled={disabled} onClick={() => void update(confirmation, true)}>Stop playback and update</Button>
          <Button variant="ghost" onClick={() => setConfirmation(null)}>Cancel</Button>
        </> : <>
          {(ready.length > 0 || includesTools) && <Button disabled={disabled || !selected.length && !includesTools} onClick={() => void update(selected)}>{disabled ? <><Spinner />Updating…</> : selected.length ? `Update ${selected.length} ${selected.length === 1 ? "device" : "devices"}` : "Update media tools"}</Button>}
          {(targets.length > 0 || includesTools) && <Button variant="ghost" disabled={disabled || center.checking} onClick={() => void check()}>{center.checking ? <><Spinner />Checking…</> : "Check for updates"}</Button>}
          {center.batch && !disabled && <Button variant="ghost" onClick={center.clearBatch}>Dismiss results</Button>}
        </>}
      </div>
    </div>
  </div>;
}

export function UpdateReviewDialog({ children }: { children: ReactNode }) {
  const { targets } = useUpdateCenter();
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>{children}</DialogTrigger>
    {/* No footer to clear in the dialog: the review's actions hold its bottom edge and padding. */}
    <DialogContent className="gap-6 bg-background pb-0 ring-0 [--bottom-bar:0px] sm:max-w-2xl" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>Review update</DialogTitle></DialogHeader>
      {open && <UpdateReview targets={targets} notesOpen />}
    </DialogContent>
  </Dialog>;
}
