import { useState } from "react";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { defaultTvAppearance, interfaceSizes, type InterfaceSize, type TvAppearance } from "../../../../shared/appearance";
import type { Credentials } from "../../../session/session";
import { saveRemoteInterfaceSize, useRemoteInterfaceSize } from "../../../interface-size";
import { TvInterfaceSize } from "./TvInterfaceSize";

type Props = { tvPresentation: boolean; credentials: Credentials | null; connected: boolean; administrator: boolean; appearance?: TvAppearance; scope?: "all" | "device" | "tv" };

const sizeChoices = interfaceSizes.map(size => ({ value: String(size.value), label: size.label }));

export function AppearanceSettings({ tvPresentation, credentials, connected, administrator, appearance = defaultTvAppearance, scope = "all" }: Props) {
  const size = useRemoteInterfaceSize();
  const [unsaved, setUnsaved] = useState(false);
  const change = async (value: InterfaceSize) => setUnsaved(!await saveRemoteInterfaceSize(value));
  return (
    <SettingsSection>
      {(tvPresentation || scope !== "device") && <TvInterfaceSize appearance={appearance} credentials={credentials} connected={connected} administrator={administrator} native={tvPresentation} />}
      {!tvPresentation && scope !== "tv" && (
        <SettingsRow label="Size on this device" description="Doesn't affect video or subtitles.">
          <ChoiceGroup label="Size on this device" value={String(size)} options={sizeChoices} onValueChange={value => void change(Number(value) as InterfaceSize)} />
        </SettingsRow>
      )}
      {unsaved && <Alert><AlertDescription>Applied, but couldn't save on this device.</AlertDescription></Alert>}
    </SettingsSection>
  );
}
