import { useState } from "react";
import { Navigate } from "@tanstack/react-router";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { couchApp } from "@/session/native-context";
import { errorText } from "@/session/session-context";
import { useUpdateCenter } from "@/session/update-center";
import { UpdateReview } from "@/sections/updates/UpdateReview";
import { updateBusy, updatesPage } from "@/sections/updates/update-presentation";
import { settingsPagePath } from "../../../../shared/settings-pages";
import type { UpdateChannel } from "../../../../shared/updates";
import { SettingsLayout } from "../SettingsLayout";
import { useSettingsScope } from "../settings-scope";

const preview = "Preview gets new features first. Switch back anytime.";

/** Both Updates pages: the review of every app this viewer can update, then each one's channel. */
function UpdatesContent({ section }: { section: "updates" | "device-updates" }) {
  const { targets, setChannel, busy, checking } = useUpdateCenter();
  const { administrator, known } = useSettingsScope();
  const [error, setError] = useState<string | null>(null);
  // An old address or a changed role opens the viewer's one Updates page.
  const page = updatesPage(administrator);
  if (known && page !== section) return <Navigate to={settingsPagePath(page ?? "device")} replace />;
  const channels = targets.filter(target => target.state);
  const local = targets.find(target => target.local);
  const run = (action: () => Promise<unknown>) => { setError(null); void action().catch(reason => setError(errorText(reason))); };
  return <>
    <UpdateReview targets={targets} />
    {channels.length > 0 && <SettingsSection title={channels.length > 1 ? "Channels" : undefined} description={channels.length > 1 ? preview : undefined}>
      {channels.map(({ id, name, state }) => <SettingsRow key={id} label={channels.length > 1 ? name : "Channel"} htmlFor={`update-channel-${id}`} description={channels.length > 1 ? undefined : preview}>
        <Select value={state!.channel} disabled={busy || checking || updateBusy(state)} onValueChange={value => run(() => setChannel(id, value as UpdateChannel))}>
          <SelectTrigger id={`update-channel-${id}`} className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="latest">Stable</SelectItem><SelectItem value="preview">Preview</SelectItem></SelectContent>
        </Select>
      </SettingsRow>)}
    </SettingsSection>}
    {local && !local.tv && couchApp && <SettingsSection><SettingsRow label="Logs" description="What Couch did in this run and the one before.">
      <Button variant="outline" onClick={() => run(couchApp!.showLogs)}>Show logs</Button>
    </SettingsRow></SettingsSection>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!targets.length && administrator && <p className="text-sm text-muted-foreground">Waiting for a Couch app to connect…</p>}
  </>;
}

export function DeviceUpdatesPage() {
  return <SettingsLayout section="device-updates"><UpdatesContent section="device-updates" /></SettingsLayout>;
}

export function UpdatesPage() {
  return <SettingsLayout section="updates"><UpdatesContent section="updates" /></SettingsLayout>;
}
