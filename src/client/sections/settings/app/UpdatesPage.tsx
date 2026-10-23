import { useState } from "react";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { couchApp } from "@/session/native-context";
import { errorText } from "@/session/session-context";
import { useUpdateCenter, type UpdateCenterTarget } from "@/session/update-center";
import { UpdateReview } from "@/sections/updates/UpdateReview";
import { updateBusy } from "@/sections/updates/update-presentation";
import type { UpdateChannel, UpdateState } from "../../../../shared/updates";
import { SettingsLayout } from "../SettingsLayout";
import { useSettingsScope } from "../settings-scope";

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

function DeviceControls({ target }: { target: UpdateCenterTarget }) {
  const { setChannel, busy } = useUpdateCenter();
  const [error, setError] = useState<string | null>(null);
  const state = target.state;
  if (!state) return null;
  const run = (action: () => Promise<unknown>) => { setError(null); void action().catch(reason => setError(errorText(reason))); };
  const channelId = `update-channel-${target.id}`;
  const last = automatic(state);
  const ready = state.status === "ready" && target.local ? `Couch ${state.available} ${!state.automatic ? "installs when you quit Couch."
    : state.automatic.installed === false || state.automatic.active === false ? "is ready. Restart to update."
    : state.automatic.last?.failed === state.available ? "didn't start last time, so it only installs when you restart to update."
    : "installs automatically overnight when nothing is playing."}` : null;
  return <SettingsSection>
    <SettingsRow label="Channel" htmlFor={channelId} description="Preview gets new features first. Switch back anytime.">
      <Select value={state.channel} disabled={busy || updateBusy(state)} onValueChange={value => run(() => setChannel(target.id, value as UpdateChannel))}>
        <SelectTrigger id={channelId} className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="latest">Stable</SelectItem><SelectItem value="preview">Preview</SelectItem></SelectContent>
      </Select>
    </SettingsRow>
    {ready && <p className="text-sm text-muted-foreground">{ready}</p>}
    {last && <SettingsRow label="Automatic updates" description={last} />}
    {target.local && !target.tv && couchApp && <SettingsRow label="Logs" description="What Couch did in this run and the one before.">
      <Button variant="outline" onClick={() => run(couchApp!.showLogs)}>Show logs</Button>
    </SettingsRow>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </SettingsSection>;
}

function UpdatesContent({ localOnly = false }: { localOnly?: boolean }) {
  const { targets } = useUpdateCenter();
  const { administrator } = useSettingsScope();
  const [selected, setSelected] = useState("");
  const visible = targets.filter(target => !localOnly || target.local);
  const target = visible.find(target => target.id === selected) ?? visible[0];
  return <>
    {!administrator && !localOnly && <p className="text-sm text-muted-foreground">Only an admin can update other Couch apps.</p>}
    <UpdateReview targets={visible} />
    {visible.length > 1 && <SettingsSection><SettingsRow label="Device settings" htmlFor="update-device">
      <Select value={target?.id} onValueChange={setSelected}>
        <SelectTrigger id="update-device" className="w-full sm:w-64"><SelectValue /></SelectTrigger>
        <SelectContent>{visible.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
      </Select>
    </SettingsRow></SettingsSection>}
    {target && <DeviceControls key={target.id} target={target} />}
    {!visible.length && administrator && <p className="text-sm text-muted-foreground">Waiting for a Couch app to connect…</p>}
  </>;
}

export function DeviceUpdatesPage() {
  return <SettingsLayout section="device-updates"><UpdatesContent localOnly /></SettingsLayout>;
}

export function UpdatesPage() {
  return <SettingsLayout section="updates"><UpdatesContent /></SettingsLayout>;
}
