import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson, apiSend, type ApiCredentials } from "@/api/client";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { couchApp } from "@/session/native-context";
import { isTvPresentation } from "@/session/presentation";
import { updateApp } from "@/session/native-updates";
import { useSessionGate } from "@/session/session-context";
import type { UpdateAction, UpdateChannel, UpdateState, UpdateTarget } from "../../../../shared/updates";
import { SettingsLayout } from "../SettingsLayout";
import { useSettingsScope } from "../settings-scope";

const statuses: Record<UpdateState["status"], string> = { idle: "Not checked yet", checking: "Checking…", "up-to-date": "Up to date", downloading: "Downloading…", ready: "Update ready", installing: "Installing…", error: "Update failed" };
const busy = (state: UpdateState) => ["checking", "downloading", "installing"].includes(state.status);
const when = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
// The TV's last root update (app/update.ts).
const automatic = ({ version, automatic }: UpdateState) => {
  if (!automatic) return null;
  if (!automatic.installed) return "Run sudo couch-setup --tv once to turn on automatic updates.";
  if (automatic.active === false) return "Automatic updates are off. You can still update and restart here.";
  const last = automatic.last;
  if (!last) return null;
  const release = last.version ?? "The update";
  const skipped = last.failed ?? last.version;
  return last.outcome === "installed" || last.outcome === "installed-unverified" ? `Updated to ${release} on ${when(last.at)}`
    : last.outcome === "rolled-back" ? `${release} didn't start, so the TV went back to ${version}`
    : last.outcome === "failed" ? `${release} didn't install on ${when(last.at)}${last.error ? `: ${last.error}` : ""}`
    : last.outcome === "waiting" ? "Waiting while media is playing. Automatic updates will check again on the next run."
    : last.outcome === "skipped" ? `Skipped ${skipped ? `Couch ${skipped}` : "a known failed version"} because it failed before. Waiting for a newer release.`
    : `Up to date. Checked ${when(last.at)}`;
};

/** Same controls for this app and the connected Couch's authenticated updater. */
function UpdateControls({ credentials, target, name, tv }: { credentials?: ApiCredentials; target?: string; name: string; tv: boolean }) {
  const client = useQueryClient();
  const [local, setLocal] = useState<UpdateState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = ["updates", target ?? "app"];
  const suffix = target ? `?device=${encodeURIComponent(target)}` : "";
  const query = useQuery({ queryKey: key, enabled: !!credentials, queryFn: ({ signal }) => apiJson<UpdateState>(credentials!, `/api/updates${suffix}`, { signal }), refetchInterval: 1_000, retry: false });
  const state = credentials ? query.data : local;
  useEffect(() => {
    if (credentials || !couchApp?.updates) return;
    void couchApp.updates().then(setLocal, (reason: Error) => setError(reason.message));
    return couchApp.onUpdates(setLocal);
  }, [credentials]);
  const run = (action: () => Promise<unknown>) => { setError(null); void action().catch((reason: Error) => setError(reason.message)); };
  const update = (action: UpdateAction) => {
    if (!credentials) return updateApp(couchApp!, action).then(setLocal);
    const { op, ...body } = action;
    return apiSend<UpdateState>(credentials, `/api/updates/${op}${suffix}`, op === "check" ? undefined : body).then(next => client.setQueryData(key, next));
  };
  const description = !state ? null
    : state.status === "downloading" ? `Couch ${state.available}${state.progress === null ? "" : `, ${state.progress}%`}`
    : state.status === "ready" ? `Couch ${state.available} ${credentials ? `is ready. Updating restarts ${name}.` : !state.automatic ? "installs when you quit Couch."
      // The timer isn't there, or skips a release that didn't start.
      : state.automatic?.installed === false || state.automatic?.active === false ? "is ready. Restart to update."
      : state.automatic?.last?.failed === state.available ? "didn't start last time, so it only installs when you restart to update."
      : "installs automatically overnight when nothing is playing."}`
    : state.checkedAt ? `Checked ${when(state.checkedAt)}` : null;
  const last = state && automatic(state);
  const channelId = credentials ? "remote-update-channel" : "update-channel";

  return <SettingsSection>
    <SettingsRow label="Updating"><span className="text-sm">{name}</span></SettingsRow>
    {state && <>
      <SettingsRow label="Version"><span className="text-sm">{state.version}</span></SettingsRow>
      <SettingsRow label="Channel" htmlFor={channelId} description="Preview gets new features first. Switch back anytime.">
        <Select value={state.channel} disabled={busy(state)} onValueChange={value => run(() => update({ op: "channel", channel: value as UpdateChannel }))}>
          <SelectTrigger id={channelId} className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="latest">Stable</SelectItem><SelectItem value="preview">Preview</SelectItem></SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow label={<span role="status" className="flex items-center gap-2">{busy(state) && <Spinner />}{statuses[state.status]}</span>} description={description}>
        {state.status === "ready"
          ? <Button onClick={() => run(() => update({ op: "install", version: state.available! }))}>{credentials ? "Update and restart" : "Restart to update"}</Button>
          : <Button variant="outline" disabled={busy(state)} onClick={() => run(() => update({ op: "check" }))}>Check for updates</Button>}
      </SettingsRow>
      {last && <SettingsRow label="Automatic updates" description={last} />}
      {!credentials && !tv && <SettingsRow label="Logs" description="What Couch did in this run and the one before.">
        <Button variant="outline" onClick={() => run(couchApp!.showLogs)}>Show logs</Button>
      </SettingsRow>}
    </>}
    {(error ?? state?.error ?? (credentials && query.error?.message)) && <Alert variant="destructive"><AlertDescription>{error ?? state?.error ?? query.error?.message}</AlertDescription></Alert>}
  </SettingsSection>;
}

/** This app's own updater and logs (unless it runs the Couch, whose updater is its own), then the Couch apps an admin updates from any paired device. */
export function UpdatesPage() {
  const { credentials, identity, connected } = useSessionGate();
  const { host, couch, administrator } = useSettingsScope();
  const [selected, setSelected] = useState("host");
  const own = !!couchApp?.updates && !host;
  const query = useQuery({ queryKey: ["updates", "targets"], enabled: administrator && !!credentials && connected, queryFn: ({ signal }) => apiJson<UpdateTarget[]>(credentials!, "/api/updates/targets", { signal }), refetchInterval: 5_000, retry: false });
  // This app's own updater comes first; the Couch's app is "host", this one where it hosts.
  const targets = (query.data ?? []).filter(target => target.id !== identity?.device?.id);
  const target = targets.find(target => target.id === selected) ?? targets[0];
  const local = host && target?.id === "host" && !!couchApp?.updates;
  const label = (item: UpdateTarget) => item.id === "host" && host ? `${item.name} (this device)` : item.name;
  return <SettingsLayout section="updates">
    {own && <UpdateControls name="This app" tv={isTvPresentation()} />}
    {!administrator ? <p className="text-sm text-muted-foreground">Only an admin can update {own ? "other " : ""}Couch apps.</p> : <>
      {targets.length > 1 && <SettingsSection><SettingsRow label="Couch app" htmlFor="update-target"><Select value={target?.id} onValueChange={setSelected}><SelectTrigger id="update-target" className="w-56"><SelectValue /></SelectTrigger><SelectContent>{targets.map(target => <SelectItem key={target.id} value={target.id}>{label(target)}</SelectItem>)}</SelectContent></Select></SettingsRow></SettingsSection>}
      {local ? <UpdateControls name={`${couch} (this device)`} tv={isTvPresentation()} />
        : target && credentials && <UpdateControls key={target.id} credentials={credentials} target={target.id} name={target.name} tv={target.tv} />}
      {query.error && <Alert variant="destructive"><AlertDescription>{query.error.message}</AlertDescription></Alert>}
      {!target && !own && !query.isPending && <p className="text-sm text-muted-foreground">Waiting for a Couch app to connect…</p>}
    </>}
  </SettingsLayout>;
}
