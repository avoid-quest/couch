import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Button } from "@/components/ui/button";
import { useShell } from "@/sections/shell/AppShell";
import { deviceName } from "@/copy";
import { SettingsLayout } from "../SettingsLayout";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { useSessionGate } from "@/session/session-context";

export function ConnectionsPage() {
  const { credentials, setAudioServerOpen } = useShell();
  const { connected, details, host, identity, remoteControlEnabled, state, externalAudio } = useSessionGate();
  return (
    <SettingsLayout section="connection">
      {identity && credentials && <ConnectionsSettings credentials={credentials} connected={connected} urls={host?.urls ?? details?.urls ?? [credentials.origin]} identity={identity} remoteControlEnabled={remoteControlEnabled}
        administratorClaimed={state?.administratorClaimed !== false} managedLan={details?.lanError !== undefined} lanError={details?.lanError} hostName={deviceName(state?.installationName ?? details?.name)} />}
      <SettingsSection title="This device’s audio">
        <SettingsRow label="Other audio server" description={externalAudio.server ? `Connected to ${externalAudio.server}.` : "Use a Sendspin server on your home network."}>
          <Button variant="outline" disabled={!connected} onClick={() => setAudioServerOpen(true)}>{externalAudio.phase === "idle" ? "Connect" : "Manage connection"}</Button>
        </SettingsRow>
      </SettingsSection>
    </SettingsLayout>
  );
}
