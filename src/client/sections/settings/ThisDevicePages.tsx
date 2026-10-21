import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { discoverRowLabels, useDiscoverRows } from "../discover/discover-rows";
import { SectionRowsSettings } from "./SectionRowsSettings";
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

// What changes only on the device in hand, and what it lets others do.

export function ThisDevicePage() {
  const { credentials } = useShell();
  const { nativeHost, tvPresentation, connected, details, state, videoQualityPreference, screenWakeLock } = useSessionGate();
  const { host, couch, administrator } = useSettingsScope();
  return <SettingsLayout section="device">
    <SettingsSection>
      <DeviceNameSettings />
      {/* A TV shows the Couch's shared text size, which its TV page changes. */}
      {!tvPresentation ? <DeviceTextSize />
        : details?.tvPresentation ? <SettingsRow label="Text size" description={`Shared by ${couch}.`}>
          <Button variant="ghost" asChild><Link to={settingsPages.display.path}>Open TV<ChevronRight aria-hidden="true" /></Link></Button>
        </SettingsRow>
        : state?.appearance && <TvInterfaceSize appearance={state.appearance} credentials={credentials} connected={connected} administrator={administrator} native />}
      {!nativeHost && <SettingsRow label="Keep screen awake" htmlFor="keep-screen-awake" description={screenWakeLock.reason || "While playing here."}>
        <Switch id="keep-screen-awake" checked={screenWakeLock.enabled} disabled={!screenWakeLock.supported} onCheckedChange={screenWakeLock.save} />
        {screenWakeLock.retryable && <Button variant="outline" onClick={screenWakeLock.retry}>Try again</Button>}
      </SettingsRow>}
      <SettingsRow label="Online video quality" description="For video you start here, wherever it plays.">
        <ChoiceGroup label="Online video quality" value={videoQualityPreference.quality} options={videoQualityOptions} onValueChange={videoQualityPreference.save} />
      </SettingsRow>
    </SettingsSection>
    {videoQualityPreference.error && <Alert variant="destructive"><AlertDescription>{videoQualityPreference.error}</AlertDescription></Alert>}
    {!nativeHost && screenWakeLock.error && <Alert variant="destructive"><AlertDescription>{screenWakeLock.error}</AlertDescription></Alert>}
    <CouchChoice credentials={credentials} installationName={state?.installationName ?? details?.name} />
    {host ? <SettingsSection title="Let other devices use" description={`${couch}'s speakers and screen are shared while Share on network is on.`} /> : <DeviceSharingSettings />}
    <DeviceInputSettings title="Share screen or sound" />
    <QuitAppSettings host={host} couch={couch} />
  </SettingsLayout>;
}

export function HomeDiscoverPage() {
  const home = useHomeRows();
  const discover = useDiscoverRows();
  return <SettingsLayout section="home">
    <SectionRowsSettings page="Home" labels={homeRowLabels} layout={home} />
    <SectionRowsSettings page="Discover" labels={discoverRowLabels} layout={discover} />
  </SettingsLayout>;
}
