import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson, apiSend, type ApiCredentials } from "@/api/client";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { couchApp } from "@/session/native-context";
import { useSessionGate } from "@/session/session-context";
import type { UpdateChannel, UpdateState, UpdateTarget } from "../../../../shared/app-bridge";
import { SettingsLayout } from "../SettingsLayout";

const statuses: Record<UpdateState["status"], string> = { idle: "Not checked yet", checking: "Checking…", "up-to-date": "Up to date", downloading: "Downloading…", ready: "Update ready", installing: "Installing…", error: "Update failed" };
const busy = (state: UpdateState) => ["checking", "downloading", "installing"].includes(state.status);
const when = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
// The TV's last root update (app/update.ts).
const automatic = ({ version, automatic }: UpdateState) => {
  if (!automatic) return null;
  if (!automatic.installed) return "Run sudo couch-setup --tv once to turn on automatic updates.";
  const last = automatic.last;
  if (!last) return null;
  const release = last.version ?? "The update";
  return last.outcome === "installed" || last.outcome === "installed-unverified" ? `Updated to ${release} on ${when(last.at)}`
    : last.outcome === "rolled-back" ? `${release} didn't start, so the TV went back to ${version}`
    : last.outcome === "failed" ? `${release} didn't install on ${when(last.at)}${last.error ? `: ${last.error}` : ""}`
    : `Last checked ${when(last.at)}`;
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
  const send = (action: string, body?: unknown) => apiSend<UpdateState>(credentials!, `/api/updates/${action}${suffix}`, body).then(next => client.setQueryData(key, next));
  const check = () => credentials ? send("check") : couchApp!.checkForUpdates();
  const channel = (channel: UpdateChannel) => credentials ? send("channel", { channel }) : couchApp!.setUpdateChannel(channel);
  const install = () => credentials ? send("install", { version: state!.available }) : couchApp!.installUpdate();
  const description = !state ? null
    : state.status === "downloading" ? `Couch ${state.available}${state.progress === null ? "" : `, ${state.progress}%`}`
    : state.status === "ready" ? `Couch ${state.available} ${credentials ? `is ready. Updating restarts ${name}.` : tv ? "installs automatically overnight when nothing is playing." : "installs when you quit Couch."}`
    : state.checkedAt ? `Checked ${new Date(state.checkedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : null;
  const last = state && automatic(state);
  const channelId = credentials ? "remote-update-channel" : "update-channel";

  return <SettingsSection>
    <SettingsRow label="Updating"><span className="text-sm">{name}</span></SettingsRow>
    {state && <>
      <SettingsRow label="Version"><span className="text-sm">{state.version}</span></SettingsRow>
      <SettingsRow label="Channel" htmlFor={channelId} description="Preview gets new features first. Switch back anytime.">
        <Select value={state.channel} disabled={busy(state)} onValueChange={value => run(() => channel(value as UpdateChannel))}>
          <SelectTrigger id={channelId} className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="latest">Stable</SelectItem><SelectItem value="preview">Preview</SelectItem></SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow label={<span role="status" className="flex items-center gap-2">{busy(state) && <Spinner />}{statuses[state.status]}</span>} description={description}>
        {state.status === "ready"
          ? <Button onClick={() => run(install)}>{credentials ? "Update and restart" : "Restart to update"}</Button>
          : <Button variant="outline" disabled={busy(state)} onClick={() => run(check)}>Check for updates</Button>}
      </SettingsRow>
      {last && <SettingsRow label="Automatic updates" description={last} />}
      {!credentials && !tv && <SettingsRow label="Logs" description="What Couch did in this run and the one before.">
        <Button variant="outline" onClick={() => run(couchApp!.showLogs)}>Show logs</Button>
      </SettingsRow>}
    </>}
    {(error ?? state?.error ?? (credentials && query.error?.message)) && <Alert variant="destructive"><AlertDescription>{error ?? state?.error ?? query.error?.message}</AlertDescription></Alert>}
  </SettingsSection>;
}

export function UpdatesPage() {
  const { credentials, identity, connected, localHost } = useSessionGate();
  const [selected, setSelected] = useState("host");
  const administrator = identity?.authority === "administrator" || identity?.authority === "host";
  const query = useQuery({ queryKey: ["updates", "targets"], enabled: administrator && !!credentials && connected, queryFn: ({ signal }) => apiJson<UpdateTarget[]>(credentials!, "/api/updates/targets", { signal }), refetchInterval: 5_000, retry: false });
  const targets = (query.data ?? []).filter(target => !couchApp?.updates || (!localHost || target.id !== "host") && target.id !== identity?.device?.id);
  const target = targets.find(target => target.id === selected) ?? targets[0];
  return <SettingsLayout section="updates">
    {targets.length > 1 && <SettingsSection><SettingsRow label="Couch app" htmlFor="update-target"><Select value={target?.id} onValueChange={setSelected}><SelectTrigger id="update-target" className="w-56"><SelectValue /></SelectTrigger><SelectContent>{targets.map(target => <SelectItem key={target.id} value={target.id}>{target.name}</SelectItem>)}</SelectContent></Select></SettingsRow></SettingsSection>}
    {target && credentials && <UpdateControls key={target.id} credentials={credentials} target={target.id} name={target.name} tv={target.tv} />}
    {couchApp?.updates && <UpdateControls name="This app" tv={couchApp.tvPresentation} />}
    {query.error && <Alert variant="destructive"><AlertDescription>{query.error.message}</AlertDescription></Alert>}
    {!target && !couchApp?.updates && <p className="text-sm text-muted-foreground">{administrator ? "Waiting for a Couch app to connect…" : "Only an admin can update Couch apps."}</p>}
  </SettingsLayout>;
}
