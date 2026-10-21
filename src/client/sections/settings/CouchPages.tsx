import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Switch } from "@/components/ui/switch";
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
import { SoundSettings } from "./couch/SoundSettings";
import { StartupSettings } from "./couch/StartupSettings";
import { TvInterfaceSize } from "./couch/TvInterfaceSize";
import { TvModeSettings } from "./couch/TvModeSettings";

// The shared Couch's pages. Every paired device opens each one; rows say when only an
// admin can change them, and the server enforces it. The Couch's name is its host's row in Devices
// (or This device's Name on the host itself).

export function DevicesPage() {
  const { credentials } = useShell();
  const { connected, details, host, identity, remoteControlEnabled, state } = useSessionGate();
  const scope = useSettingsScope();
  const urls = host?.urls ?? details?.urls ?? (credentials ? [credentials.origin] : []);
  return <SettingsLayout section="devices">
    {identity && credentials && <DevicesSettings credentials={credentials} connected={connected} urls={urls} identity={identity} remoteControlEnabled={remoteControlEnabled}
      administratorClaimed={state?.administratorClaimed !== false} hostName={scope.couch} online={new Set(state?.devices?.filter(device => device.online).map(device => device.id))} />}
    {credentials && <NetworkSettings credentials={credentials} connected={connected} urls={urls} remoteControlEnabled={remoteControlEnabled}
      managedLan={details?.lanError !== undefined} lanError={details?.lanError} device={scope.device} couch={scope.couch} host={scope.host} administrator={scope.administrator} />}
  </SettingsLayout>;
}

// Playback preferences belong to the active watching profile; any paired device changes them.
export function PlaybackPage() {
  const { credentials } = useShell();
  const { connected, state, run } = useSessionGate();
  const { administrator } = useSettingsScope();
  const profile = state?.activeProfile;
  const preferences = state?.preferences;
  const chooser = useMutation({ mutationFn: (enabled: boolean) => run({ type: "askEveryDevice", enabled }) });
  return <SettingsLayout section="playback">
    <SettingsSection description={profile && `For ${profile.name}, on every device.`}>
      {profile && preferences && credentials && <PlaybackPreferences key={profile.id} profile={profile} preferences={preferences} connected={connected} onCommand={run} />}
      <SettingsRow label="Ask every device where a shared source plays" htmlFor="ask-every-device" className="[&_label]:touch:min-h-11 [&_label]:items-center"
        description={`Off: only the device that pressed Play asks.${administrator ? "" : ` ${ADMIN_ONLY}`}`}>
        <Switch id="ask-every-device" checked={chooser.isPending ? chooser.variables : state?.askEveryDevice ?? false} disabled={!administrator || !connected || chooser.isPending} onCheckedChange={enabled => chooser.mutate(enabled)} />
      </SettingsRow>
    </SettingsSection>
  </SettingsLayout>;
}

export function SourcesPage({ section }: { section: SettingsPage }) {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  const { administrator } = useSettingsScope();
  const source = section.startsWith("source-") ? section.slice(7) as SourceKind : undefined;
  return <SettingsLayout section={section}>
    <SettingsSources canManage={administrator} connected={connected} credentials={credentials} source={source} />
    {!source && <p className="text-sm text-muted-foreground">Share this device's screen or sound from <Link className="underline underline-offset-4" to={settingsPages.device.path}>This device › General</Link>.</p>}
  </SettingsLayout>;
}

// The Couch's speakers, Bluetooth ones included. Reading them needs an admin too, so others see what each row does.
export function SoundPage() {
  const { credentials } = useShell();
  const { connected } = useSessionGate();
  const { couch, administrator } = useSettingsScope();
  return <SettingsLayout section="sound">
    {!administrator ? <>
      <SettingsSection><SettingsRow label="Output" description={`The speakers ${couch} plays through. ${ADMIN_ONLY}`} /></SettingsSection>
      <SettingsSection title="Test & delay">
        <SettingsRow label="Audio delay" description={ADMIN_ONLY} />
        <SettingsRow label="Test tone" description={ADMIN_ONLY} />
      </SettingsSection>
      <SettingsSection title="Bluetooth" description={`Pair, connect or forget ${couch}'s Bluetooth speakers. ${ADMIN_ONLY}`} />
    </> : credentials && <>
      <SoundSettings credentials={credentials} connected={connected} hostName={couch} />
      <BluetoothSettings credentials={credentials} connected={connected} />
    </>}
  </SettingsLayout>;
}

// The TV the Couch runs on: its mode, startup, screen and shared text size.
export function DisplayPage() {
  const { credentials } = useShell();
  const { connected, details, state, tvPresentation } = useSessionGate();
  const { couch, administrator } = useSettingsScope();
  const appliance = details?.tvAppliance ?? details?.tvPresentation;
  return <SettingsLayout section="display">
    {(credentials && (details?.tvModeChangeable || details?.tvAppliance) || appliance) && <SettingsSection>
      {credentials && (details?.tvModeChangeable || details?.tvAppliance) && <TvModeSettings key={String(details.tvPresentation)} credentials={credentials} connected={connected}
        administrator={administrator} couch={couch} enabled={!!details.tvPresentation} locked={!!details.tvAppliance} />}
      {appliance && (administrator && credentials ? <StartupSettings credentials={credentials} connected={connected} /> : <SettingsRow label="Start on boot" description={ADMIN_ONLY} />)}
    </SettingsSection>}
    {details?.tvPresentation && <>
      {!administrator ? <SettingsSection title="Screen" description={ADMIN_ONLY} /> : credentials && <DisplaySettings title="Screen" credentials={credentials} connected={connected} />}
      {state?.appearance && <SettingsSection title="Text size">
        <TvInterfaceSize appearance={state.appearance} credentials={credentials} connected={connected} administrator={administrator} native={tvPresentation} />
      </SettingsSection>}
    </>}
  </SettingsLayout>;
}
