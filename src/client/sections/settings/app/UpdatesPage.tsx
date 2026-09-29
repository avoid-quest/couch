import { useEffect, useState } from "react";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { couchApp } from "@/session/native-context";
import type { UpdateChannel, UpdateState } from "../../../../shared/app-bridge";
import { SettingsLayout } from "../SettingsLayout";

const statuses: Record<UpdateState["status"], string> = { idle: "Not checked yet", checking: "Checking…", "up-to-date": "Up to date", downloading: "Downloading…", ready: "Update ready", installing: "Installing…", error: "Update failed" };
const busy = (state: UpdateState) => ["checking", "downloading", "installing"].includes(state.status);

/** This app's version, update channel and logs, from Main (app/update.ts). */
export function UpdatesPage() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!couchApp?.updates) return;
    void couchApp.updates().then(setState, (reason: Error) => setError(reason.message));
    return couchApp.onUpdates(setState);
  }, []);
  const run = (action: () => Promise<unknown>) => { setError(null); void action().catch((reason: Error) => setError(reason.message)); };
  const tv = couchApp?.tvPresentation;
  const description = !state ? null
    : state.status === "downloading" ? `Couch ${state.available}${state.progress === null ? "" : `, ${state.progress}%`}`
    : state.status === "ready" ? `Couch ${state.available} ${tv ? "installs when nothing is playing." : "installs when you quit Couch."}`
    : state.checkedAt ? `Checked ${new Date(state.checkedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : null;

  return (
    <SettingsLayout section="updates">
      {!couchApp?.updates ? <p className="text-sm text-muted-foreground">Only in the Couch app.</p> : state && <SettingsSection>
        <SettingsRow label="Version"><span className="text-sm">{state.version}</span></SettingsRow>
        <SettingsRow label="Channel" htmlFor="update-channel" description="Preview gets new features first. Switch back anytime.">
          <Select value={state.channel} disabled={busy(state)} onValueChange={channel => run(() => couchApp!.setUpdateChannel(channel as UpdateChannel))}>
            <SelectTrigger id="update-channel" className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="latest">Stable</SelectItem><SelectItem value="preview">Preview</SelectItem></SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label={<span role="status" className="flex items-center gap-2">{busy(state) && <Spinner />}{statuses[state.status]}</span>} description={description}>
          {state.status === "ready"
            ? <Button onClick={() => run(couchApp!.installUpdate)}>Restart to update</Button>
            : <Button variant="outline" disabled={busy(state)} onClick={() => run(couchApp!.checkForUpdates)}>Check for updates</Button>}
        </SettingsRow>
        {!tv && <SettingsRow label="Logs" description="What Couch did in this run and the one before.">
          <Button variant="outline" onClick={() => run(couchApp!.showLogs)}>Show logs</Button>
        </SettingsRow>}
        {(error ?? state.error) && <Alert variant="destructive"><AlertDescription>{error ?? state.error}</AlertDescription></Alert>}
      </SettingsSection>}
    </SettingsLayout>
  );
}
