import { Link } from "@tanstack/react-router";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import type { SourceKind } from "@/components/sourceTypes";
import { ADMIN_ONLY } from "@/copy";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { SettingsLayout } from "./SettingsLayout";
import { SettingsSources } from "./SettingsSources";
import { useSettingsScope } from "./settings-scope";
import { BluetoothSettings } from "./couch/BluetoothSettings";
import { DevicesSettings } from "./couch/DevicesSettings";
import { DisplaySettings } from "./couch/DisplaySettings";
import { NetworkSettings } from "./couch/NetworkSettings";
import { PlaybackPreferences } from "./couch/PlaybackPreferences";
import { RenameCouch } from "./couch/RenameCouch";
import { SoundSettings } from "./couch/SoundSettings";
import { StartupSettings } from "./couch/StartupSettings";
import { TvInterfaceSize } from "./couch/TvInterfaceSize";
import { TvModeSettings } from "./couch/TvModeSettings";

// The shared Couch's pages. Every paired device opens each one; rows say when only an
// admin can change them, and the server enforces it.

export function CouchGeneralPage() {
  const { credentials } = useShell();
  const { connected, details } = useSessionGate();
  const { couch, host, administrator } = useSettingsScope();
  const appliance = details?.tvAppliance ?? details?.tvPresentation;
  return <SettingsLayout section="couch" title={couch}>
    <SettingsSection>
      <SettingsRow label="Name" description={`${host ? "Same as this device's name. " : ""}Every device shows it.${administrator ? "" : ` ${ADMIN_ONLY}`}`}>
        <span className="mr-auto text-sm">{couch}</span>
        {administrator && credentials && <RenameCouch credentials={credentials} connected={connected} name={couch} />}
      </SettingsRow>
      {credentials && (details?.tvModeChangeable || details?.tvAppliance) && <TvModeSettings key={String(details.tvPresentation)} credentials={credentials} connected={connected}
        administrator={administrator} couch={couch} enabled={!!details.tvPresentation} locked={!!details.tvAppliance} />}
      {appliance && (administrator && credentials ? <StartupSettings credentials={credentials} connected={connected} /> : <SettingsRow label="Start on boot" description={ADMIN_ONLY} />)}
    </SettingsSection>
  </SettingsLayout>;
}

export function DevicesPage() {
  const { credentials } = useShell();
  const { connected, details, host, identity, remoteControlEnabled, state } = useSessionGate();
  const { couch } = useSettingsScope();
  return <SettingsLayout section="devices">
    {identity && credentials && <DevicesSettings credentials={credentials} connected={connected} urls={host?.urls ?? details?.urls ?? [credentials.origin]} identity={identity} remoteControlEnabled={remoteControlEnabled}
      administratorClaimed={state?.administratorClaimed !== false} hostName={couch} online={new Set(state?.devices?.filter(device => device.online).map(device => device.id))} />}
  </SettingsLayout>;
}

export function NetworkPage() {
  const { credentials } = useShell();
  const { connected, details, host, remoteControlEnabled } = useSessionGate();
  const scope = useSettingsScope();
  return <SettingsLayout section="network">
    {credentials && <NetworkSettings credentials={credentials} connected={connected} urls={host?.urls ?? details?.urls ?? [credentials.origin]} remoteControlEnabled={remoteControlEnabled}
      managedLan={details?.lanError !== undefined} lanError={details?.lanError} device={scope.device} couch={scope.couch} host={scope.host} administrator={scope.administrator} />}
  </SettingsLayout>;
}

// Playback preferences belong to the active watching profile; any paired device changes them.
export function PlaybackPage() {
  const { credentials } = useShell();
  const { connected, state, run } = useSessionGate();
  const profile = state?.activeProfile;
  const preferences = state?.preferences;
  return <SettingsLayout section="playback" title={profile ? `Playback · ${profile.name}` : undefined}>
    {profile && preferences && credentials && <SettingsSection description={`For the ${profile.name} watching profile, on every device. Anyone paired can change these.`}>
      <PlaybackPreferences key={profile.id} profile={profile} preferences={preferences} connected={connected} onCommand={run} />
    </SettingsSection>}
  </SettingsLayout>;
}

export function SourcesPage({ section }: { section: SettingsPage }) {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  const { administrator } = useSettingsScope();
  const source = section.startsWith("source-") ? section.slice(7) as SourceKind : undefined;
  return <SettingsLayout section={section}>
    <SettingsSources canManage={administrator} connected={connected} credentials={credentials} source={source} />
    {!source && <p className="text-sm text-muted-foreground">Sharing this device's screen or sound is in <Link className="underline underline-offset-4" to={settingsPages.sharing.path}>This device → Sharing</Link>.</p>}
  </SettingsLayout>;
}

export function SoundPage() {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  const { couch, administrator } = useSettingsScope();
  return <SettingsLayout section="sound">
    {/* Reading the outputs needs an admin too, so others see what each row does. */}
    {!administrator ? <>
      <SettingsSection><SettingsRow label="Output" description={`The speakers ${couch} plays through. ${ADMIN_ONLY}`} /></SettingsSection>
      <SettingsSection title="Test & delay">
        <SettingsRow label="Audio delay" description={`Positive values play sound later. ${ADMIN_ONLY}`} />
        <SettingsRow label="Test tone" description={`Plays a 3-second left/right tone on ${couch}. ${ADMIN_ONLY}`} />
      </SettingsSection>
    </> : credentials && <SoundSettings credentials={credentials} connected={connected} hostName={couch} />}
  </SettingsLayout>;
}

export function BluetoothPage() {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  const { couch, administrator } = useSettingsScope();
  return <SettingsLayout section="bluetooth">
    {!administrator ? <>
      <SettingsSection><SettingsRow label="Add a device" description={`Pair a speaker with ${couch}. ${ADMIN_ONLY}`} /></SettingsSection>
      <SettingsSection title="Devices" description={`Connect, disconnect or forget ${couch}'s Bluetooth devices. ${ADMIN_ONLY}`} />
    </> : credentials && <BluetoothSettings credentials={credentials} connected={connected} />}
  </SettingsLayout>;
}

export function DisplayPage() {
  const { credentials } = useShell();
  const { connected, details, state, tvPresentation } = useSessionGate();
  const { couch, administrator } = useSettingsScope();
  if (!details?.tvPresentation) return <SettingsLayout section="display"><p className="text-sm text-muted-foreground">Only on Couch for Linux TVs.</p></SettingsLayout>;
  return <SettingsLayout section="display">
    {!administrator ? <SettingsSection title="Screen" description={ADMIN_ONLY} /> : credentials && <DisplaySettings title="Screen" credentials={credentials} connected={connected} />}
    {state?.appearance && <SettingsSection title={`Text size on ${couch}`}>
      <TvInterfaceSize appearance={state.appearance} credentials={credentials} connected={connected} administrator={administrator} native={tvPresentation} />
    </SettingsSection>}
  </SettingsLayout>;
}
