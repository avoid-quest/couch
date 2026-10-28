import { useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ApiError } from "@/api/client";
import { SettingsRow } from "@/components/SettingsRow";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { deviceId } from "@/session/device-id";
import { errorText, useSessionGate } from "@/session/session-context";
import { useUpdateCenter, type UpdateCenterTarget } from "@/session/update-center";
import { UPDATE_INTERRUPTS_PLAYBACK } from "../../../shared/updates";
import type { HelperUpdates } from "../../../shared/helper-updates";
import { ReleaseNotes } from "./ReleaseNotes";
import { automaticUpdateStatus, mediaToolVersion, updateInstallHint, updateBusy, updateInterrupts, updateReady, updateStatuses } from "./update-presentation";

const helperStatuses: Record<HelperUpdates["items"][number]["status"], string> = { checking: "Checking…", updated: "Updated", current: "Up to date", compatible: "Compatible", held: "Kept for compatibility", system: "Managed by the system", error: "Update failed" };
const batchStatuses = { waiting: "Waiting", installing: "Updating…", updated: "Updated", failed: "Update failed" };

function MediaTools() {
  const { helpers, helperError, batch } = useUpdateCenter();
  const skipped = batch?.helpers === "skipped";
  const problem = batch?.helperError ?? helperError ?? helpers?.items.filter(item => item.status === "error").map(item => `${item.name}: ${item.error ?? "Update failed"}`).join("; ");
  const checking = helpers?.status === "checking" || batch?.helpers === "checking";
  return <SettingsRow label="Media tools" description={helpers?.items.map(item => {
    const version = mediaToolVersion(item);
    return `${item.name === "qjs" ? "QuickJS" : item.name === "ffmpeg" ? "FFmpeg" : item.name}${version ? ` ${version}` : ""}${["held", "system"].includes(item.status) ? ` (${helperStatuses[item.status].toLowerCase()})` : ""}`;
  }).join(", ")}>
    <span className={cn("flex min-w-0 items-center gap-2 break-words text-sm", problem && !skipped ? "text-destructive" : "text-muted-foreground")}>
      {checking && <Spinner />}
      {problem || (checking ? "Checking…" : helpers?.items.some(item => item.status === "held") ? "Kept for compatibility" : helpers?.status === "done" ? "Up to date" : helpers?.items.length ? "Compatible" : "Not checked yet")}
    </span>
  </SettingsRow>;
}

/** Device status, release notes and actions live together in Updates settings. */
export function UpdateReview({ targets }: { targets: UpdateCenterTarget[] }) {
  const center = useUpdateCenter();
  const { localHost, state } = useSessionGate();
  const includesTools = center.canMaintain;
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string[] | null>(null);
  const [acting, setActing] = useState(false);
  const pending = useRef(false);
  const actions = useRef<HTMLDivElement>(null);
  const id = useId();
  const ready = targets.filter(target => updateReady(target.state));
  // A failed or unfinished device stays ready and selected, so Update retries what remains.
  const selected = ready.filter(target => ready.length === 1 || choices[target.id] !== false).map(target => target.id);
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
    <div className="@container **:scroll-mb-[calc(var(--update-actions)+.5rem)]">
      {targets.map(target => {
        const state = target.state;
        const item = center.batch?.items.find(item => item.id === target.id && (item.status !== "updated" || state?.version === item.version && !state.available));
        const available = updateReady(state);
        const selectable = available && ready.length > 1;
        const problem = item?.error ?? target.error ?? state?.error;
        return <SettingsRow key={target.id} data-nav-row label={target.name} htmlFor={selectable ? `${id}-${target.id}` : undefined} description={<>
          <span className="block">{state ? `${state.version}${state.available ? ` to ${state.available}` : ""}` : "Waiting for update information…"}</span>
          {state && <><span className="block">{updateInstallHint(state, target.local)}</span><span className="block">{automaticUpdateStatus(state)}</span></>}
          {problem && <span className="mt-1 block text-destructive">{problem}</span>}
        </>}>
          {selectable && <Checkbox id={`${id}-${target.id}`} aria-label={`Update ${target.name}`} checked={choices[target.id] !== false} disabled={disabled} onCheckedChange={checked => { setChoices(previous => ({ ...previous, [target.id]: checked === true })); setConfirmation(null); }} />}
          <span className={cn("flex items-center gap-2 text-sm", available ? "text-foreground" : "text-muted-foreground")}>
            {(item?.status === "waiting" || item?.status === "installing" || updateBusy(state)) && <Spinner />}
            {item ? batchStatuses[item.status] : state ? updateStatuses[state.status] : ""}
          </span>
          {state?.status === "downloading" && state.progress !== null && <Progress value={state.progress} aria-label={`Downloading update for ${target.name}`} className="basis-full" />}
        </SettingsRow>;
      })}
      {/* Retain named results even when the device went offline during its restart. */}
      {center.batch?.items.filter(item => !targets.some(target => target.id === item.id)).map(item => <div key={item.id} className="text-sm"><span>{item.name}</span><span className="ml-3 text-muted-foreground">{batchStatuses[item.status]}</span>{item.error && <p className="break-words text-destructive">{item.error}</p>}</div>)}
      {includesTools && <MediaTools />}
    </div>
    {ready.length > 0 && <Collapsible open={notes} onOpenChange={setNotes} className="**:scroll-mb-[calc(var(--update-actions)+.5rem)]">
      <CollapsibleTrigger asChild><Button variant="ghost" className="-ml-3">What’s new<ChevronDown aria-hidden="true" className={cn(notes && "rotate-180")} /></Button></CollapsibleTrigger>
      <CollapsibleContent className="pt-3">{notes && <ReleaseNotes targets={ready} />}</CollapsibleContent>
    </Collapsible>}
    {/* Long notes scroll beneath actions that stay above the footer; the desktop scroller already ends there. */}
    <div ref={actions} data-nav-footer className="sticky bottom-[var(--bottom-bar,0px)] in-[.electron]:bottom-0 z-10 -mt-3 space-y-3 bg-background py-3">
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {confirmation ? <p role="alert" className="text-sm">Updating will stop playback and any screen or sound sharing on the selected apps.</p>
        : selected.length > 0 && <p className="text-sm text-muted-foreground">{targets.some(target => target.local && selected.includes(target.id)) ? "Selected apps restart. This app restarts last." : "Selected apps restart."}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {confirmation ? <>
          <Button disabled={disabled} onClick={() => void update(confirmation, true)}>Stop playback and update</Button>
          <Button variant="ghost" onClick={() => setConfirmation(null)}>Cancel</Button>
        </> : <>
          {(ready.length > 0 || center.busy && !!center.batch?.items.length) && <Button className="h-auto min-h-control max-w-full whitespace-normal py-1.5 text-left" disabled={disabled || center.checking || !selected.length} onClick={() => void update(selected)}>{disabled ? <><Spinner />Updating…</> : ready.length === 1 ? `Update ${ready[0]!.name}` : selected.length ? `Update ${selected.length} ${selected.length === 1 ? "device" : "devices"}` : "Update devices"}</Button>}
          {(targets.length > 0 || includesTools) && <Button variant="outline" disabled={disabled || center.checking} onClick={() => void check()}>{center.checking ? <><Spinner />Checking…</> : "Check for updates"}</Button>}
        </>}
      </div>
    </div>
  </div>;
}
