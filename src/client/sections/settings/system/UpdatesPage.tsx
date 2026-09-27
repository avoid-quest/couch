import { useState } from "react";
import { useShell } from "@/sections/shell/AppShell";
import { deviceName } from "@/copy";
import { Button } from "@/components/ui/button";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { InstallationUpdates } from "@/sections/shell/PlaybackDevice";
import { SettingsLayout } from "../SettingsLayout";
import { UpdatesSettings } from "./UpdatesSettings";
import { useSessionGate } from "@/session/session-context";

export function UpdatesPage() {
  const { credentials } = useShell();
  const { connected, nativeHost, localHost, tvPresentation, state, details } = useSessionGate();
  const [ownUpdatesOpen, setOwnUpdatesOpen] = useState(false);
  const remoteTv = nativeHost && tvPresentation && !localHost;
  return (
    <SettingsLayout section="updates">
      {credentials && <UpdatesSettings credentials={credentials} connected={connected} target={localHost ? "this app" : "selected host"} hostName={deviceName(state?.installationName ?? details?.name)} />}
      {remoteTv && <SettingsSection><SettingsRow label="This TV" description="Updates Couch on this TV, independently of the selected library."><Button variant="outline" onClick={() => setOwnUpdatesOpen(true)}>Update this TV</Button></SettingsRow></SettingsSection>}
      {remoteTv && <InstallationUpdates open={ownUpdatesOpen} onOpenChange={setOwnUpdatesOpen} tvNavigable />}
    </SettingsLayout>
  );
}
