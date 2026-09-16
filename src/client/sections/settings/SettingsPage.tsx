import { Settings } from "../../Settings";
import { useShell } from "../../shell";
import type { SettingsPage } from "../../../shared/settings-pages";

export function SettingsPage({ section }: { section: SettingsPage }) {
  const shell = useShell();
  const { state, credentials, connected, statusLabel, identity, details, playerStatus, pairingRequired, reachable, host, run, reconnect, unpair, videoQualityPreference, section: active, setRemoteControlEnabled, changeSettingsSection, changeSection } = shell;
  return (
    <section data-page="Settings">
      <Settings onRemoteControlChange={setRemoteControlEnabled} inline section={section} onSectionChange={changeSettingsSection} active={active === "Settings"} onOpenRequest={() => changeSection("Settings")} libraryVersion={state?.libraryVersion ?? 0} jellyfinVersion={state?.jellyfinVersion ?? 0} radioVersion={state?.radioVersion ?? 0} videoQualityPreference={videoQualityPreference} credentials={credentials} connected={connected} status={statusLabel} identity={identity} details={details} playerStatus={playerStatus} pairingRequired={pairingRequired} reachable={reachable} host={host} name={state?.installationName ?? details?.name ?? "Couch"} version={state?.controllerVersion ?? 0} appearance={state?.appearance} administratorClaimed={state?.administratorClaimed === true} onReconnect={reconnect} onPairAgain={unpair} profile={state?.activeProfile} preferences={state?.preferences} onCommand={run} />
    </section>
  );
}
