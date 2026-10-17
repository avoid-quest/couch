import { Link } from "@tanstack/react-router";
import { ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { homeRowLabels, useHomeRows } from "@/sections/home/home-rows";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { videoQualityOptions } from "@/video-quality";
import { settingsPages } from "../../../shared/settings-pages";
import { SettingsLayout } from "./SettingsLayout";
import { useSettingsScope } from "./settings-scope";
import { TvInterfaceSize } from "./couch/TvInterfaceSize";
import { DeviceInputSettings } from "./sources/DeviceInputSettings";
import { CouchChoice } from "./this-device/CouchChoice";
import { DeviceNameSettings } from "./this-device/DeviceNameSettings";
import { DeviceSharingSettings } from "./this-device/DeviceSharingSettings";
import { DeviceTextSize } from "./this-device/DeviceTextSize";
import { QuitAppSettings } from "./this-device/QuitAppSettings";

// This device's pages: what changes only here, and what this device allows others to do.

export function GeneralPage() {
  const { host, couch } = useSettingsScope();
  return <SettingsLayout section="general">
    <SettingsSection><DeviceNameSettings /></SettingsSection>
    <QuitAppSettings host={host} couch={couch} />
  </SettingsLayout>;
}

export function ConnectionPage() {
  const { credentials } = useShell();
  const { state, details } = useSessionGate();
  return <SettingsLayout section="connection">
    <CouchChoice credentials={credentials} installationName={state?.installationName ?? details?.name} />
  </SettingsLayout>;
}

export function ViewingPage() {
  const { credentials } = useShell();
  const { nativeHost, tvPresentation, connected, details, state, videoQualityPreference, screenWakeLock } = useSessionGate();
  const { couch, administrator } = useSettingsScope();
  return <SettingsLayout section="viewing">
    <SettingsSection>
      {/* A TV shows the Couch's shared text size, which its Display page changes. */}
      {!tvPresentation ? <DeviceTextSize />
        : details?.tvPresentation ? <SettingsRow label="Text size" description={`${couch}'s text size is shared, so it's with ${couch}'s Display.`}>
          <Button variant="ghost" asChild><Link to={settingsPages.display.path}>Open Display<ChevronRight aria-hidden="true" /></Link></Button>
        </SettingsRow>
        : state?.appearance && <TvInterfaceSize appearance={state.appearance} credentials={credentials} connected={connected} administrator={administrator} native />}
      {!nativeHost && <SettingsRow label="Keep screen awake" htmlFor="keep-screen-awake"
        description={`While playing on this device, with Couch visible.${screenWakeLock.reason ? ` ${screenWakeLock.reason}` : ""}`}>
        <Switch id="keep-screen-awake" checked={screenWakeLock.enabled} disabled={!screenWakeLock.supported} onCheckedChange={screenWakeLock.save} />
        {screenWakeLock.retryable && <Button variant="outline" onClick={screenWakeLock.retry}>Try again</Button>}
      </SettingsRow>}
      <SettingsRow label="Online video you start" description="Default quality for online video started from this device, wherever it plays.">
        <ChoiceGroup label="Online video quality" value={videoQualityPreference.quality} options={videoQualityOptions} onValueChange={videoQualityPreference.save} />
      </SettingsRow>
    </SettingsSection>
    {videoQualityPreference.error && <Alert variant="destructive"><AlertDescription>{videoQualityPreference.error}</AlertDescription></Alert>}
    {!nativeHost && screenWakeLock.error && <Alert variant="destructive"><AlertDescription>{screenWakeLock.error}</AlertDescription></Alert>}
  </SettingsLayout>;
}

export function HomePage() {
  const layout = useHomeRows();
  return <SettingsLayout section="home">
    <SettingsSection description="Choose Home's shelves and their order on this device. An empty shelf stays hidden.">
      <ol aria-label="Home shelves">
        {layout.rows.map((row, index) => <li key={row.id}>
          <SettingsRow label={homeRowLabels[row.id]} className="[&_label]:touch:min-h-11 [&_label]:items-center" htmlFor={`home-row-${row.id}`}>
            <Switch id={`home-row-${row.id}`} checked={row.shown} onCheckedChange={checked => layout.toggle(row.id, checked)} />
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" size="icon" aria-label={`Move ${homeRowLabels[row.id]} up`} disabled={index === 0} onClick={() => layout.move(row.id, -1)}><ChevronUp aria-hidden="true" /></Button>
              <Button variant="ghost" size="icon" aria-label={`Move ${homeRowLabels[row.id]} down`} disabled={index === layout.rows.length - 1} onClick={() => layout.move(row.id, 1)}><ChevronDown aria-hidden="true" /></Button>
            </div>
          </SettingsRow>
        </li>)}
      </ol>
      <Button variant="ghost" className="self-start -ml-2.5" onClick={layout.reset}>Reset to default</Button>
    </SettingsSection>
  </SettingsLayout>;
}

export function SharingPage() {
  const { host, couch } = useSettingsScope();
  return <SettingsLayout section="sharing">
    {host ? <SettingsSection title="Let other devices use" description={`${couch}'s own speakers and screen are shared while Share on network is on.`} /> : <DeviceSharingSettings />}
    <DeviceInputSettings title="Share screen or sound" />
  </SettingsLayout>;
}
