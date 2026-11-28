import { ClientAudioSettings } from "./AdvancedAudioSettings";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SectionRowsSettings } from "./SectionRowsSettings";
import { Switch } from "@/components/ui/switch";
import { homeRows, useHomeRows } from "@/sections/home/home-rows";
import { AddSection, useFollowedRows } from "@/sections/home/FollowedSettings";
import { ShareButton } from "@/sections/share/ShareDialog";
import { useShowShare } from "@/sections/share/show-share";
import { useShell } from "@/sections/shell/AppShell";
import { useSessionGate } from "@/session/session-context";
import { couchApp } from "@/session/native-context";
import { canSetReporting } from "@/error-reporting";
import { videoQualityOptions } from "@/video-quality";
import { settingsPages } from "../../../shared/settings-pages";
import { SettingsLayout } from "./SettingsLayout";
import { useSettingsScope } from "./settings-scope";
import { TvInterfaceSize } from "./couch/TvInterfaceSize";
import { CouchChoice } from "./this-device/CouchChoice";
import { ErrorReportingSetting } from "./this-device/ErrorReportingSetting";
import { DeviceNameSettings } from "./this-device/DeviceNameSettings";
import { DeviceSharingSettings } from "./this-device/DeviceSharingSettings";
import { DeviceTextSize } from "./this-device/DeviceTextSize";
import { MessageSettings } from "./this-device/MessageSettings";
import { PlayerSideSetting } from "./this-device/PlayerSideSetting";
import { QuitAppSettings } from "./this-device/QuitAppSettings";

// What changes only on the device in hand, and what it lets others do, by intent: who it is, what you play from here, the
// Couch it shows, what others may use, and the rest.

export function ThisDevicePage() {
  const { credentials } = useShell();
  const {
    nativeHost,
    tvPresentation,
    connected,
    details,
    state,
    videoQualityPreference,
    screenWakeLock,
  } = useSessionGate();
  const { host, couch, administrator } = useSettingsScope();
  const share = useShowShare();
  const shareable = !!navigator.mediaDevices?.getUserMedia;
  return (
    <SettingsLayout section="device">
      <SettingsSection>
        <DeviceNameSettings />
        {/* A TV shows the Couch's shared text size, which its TV page changes. */}
        {!tvPresentation ? (
          <DeviceTextSize />
        ) : details?.tvPresentation ? (
          <SettingsRow label="Text size" description={`Shared by ${couch}.`}>
            <Button variant="ghost" asChild>
              <Link to={settingsPages.display.path}>
                Open TV
                <ChevronRight aria-hidden="true" />
              </Link>
            </Button>
          </SettingsRow>
        ) : (
          state?.appearance && (
            <TvInterfaceSize
              appearance={state.appearance}
              credentials={credentials}
              connected={connected}
              administrator={administrator}
              native
            />
          )
        )}
        <PlayerSideSetting />
        {!nativeHost && (
          <SettingsRow
            label="Keep screen awake"
            htmlFor="keep-screen-awake"
            description={screenWakeLock.reason || "While playing here."}
          >
            <Switch
              id="keep-screen-awake"
              checked={screenWakeLock.enabled}
              disabled={!screenWakeLock.supported}
              onCheckedChange={screenWakeLock.save}
            />
            {screenWakeLock.retryable && (
              <Button variant="outline" onClick={screenWakeLock.retry}>
                Try again
              </Button>
            )}
          </SettingsRow>
        )}
        {!nativeHost && screenWakeLock.error && (
          <Alert variant="destructive">
            <AlertDescription>{screenWakeLock.error}</AlertDescription>
          </Alert>
        )}
      </SettingsSection>
      <MessageSettings />
      <SettingsSection title="What you play from here">
        <SettingsRow
          label="Online video quality"
          description="For video you start here, wherever it plays."
        >
          <ChoiceGroup
            label="Online video quality"
            variant="segmented"
            value={videoQualityPreference.quality}
            options={videoQualityOptions}
            onValueChange={videoQualityPreference.save}
          />
        </SettingsRow>
        {videoQualityPreference.error && (
          <Alert variant="destructive">
            <AlertDescription>{videoQualityPreference.error}</AlertDescription>
          </Alert>
        )}
        {/* Hidden from the header (a TV's default), Share starts here. */}
        {shareable && (
          <SettingsRow label="Show Share in the header" htmlFor="show-share">
            <Switch id="show-share" checked={share.shown} onCheckedChange={share.save} />
            {!share.shown && <ShareButton tv={tvPresentation}>Share screen or sound</ShareButton>}
          </SettingsRow>
        )}
      </SettingsSection>
      <CouchChoice
        credentials={credentials}
        installationName={state?.installationName ?? details?.name}
      />
      {host ? (
        <SettingsSection
          title="Let other devices use"
          description={`${couch}'s speakers and screen are shared while Share on network is on.`}
        />
      ) : (
        <DeviceSharingSettings />
      )}
      {(nativeHost || canSetReporting || !!couchApp?.quit) && (
        <SettingsSection title="Advanced">
          <ClientAudioSettings capture={nativeHost} />
          <ErrorReportingSetting />
          <QuitAppSettings host={host} couch={couch} />
        </SettingsSection>
      )}
    </SettingsLayout>
  );
}

export function HomeSettingsPage() {
  const home = useHomeRows();
  const followed = useFollowedRows();
  return (
    <SettingsLayout section="home">
      <SectionRowsSettings
        page="Home"
        rows={{ ...homeRows, ...followed.rows }}
        layout={home}
        actions={followed.actions}
      >
        <AddSection />
      </SectionRowsSettings>
    </SettingsLayout>
  );
}
