import { useState } from "react";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { SettingsRow } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { interfaceSizes, type InterfaceSize } from "../../../../shared/appearance";
import { saveRemoteInterfaceSize, useRemoteInterfaceSize } from "../../../interface-size";

const sizeChoices = interfaceSizes.map(size => ({ value: String(size.value), label: size.label }));

/** Text size on this device only. A TV's text size is the Couch's, in Display. */
export function DeviceTextSize() {
  const size = useRemoteInterfaceSize();
  const [unsaved, setUnsaved] = useState(false);
  const change = async (value: InterfaceSize) => setUnsaved(!await saveRemoteInterfaceSize(value));
  return <>
    <SettingsRow label="Text size" description="On this device only. Doesn't affect video or subtitles.">
      <ChoiceGroup label="Text size on this device" value={String(size)} options={sizeChoices} onValueChange={value => void change(Number(value) as InterfaceSize)} />
    </SettingsRow>
    {unsaved && <Alert><AlertDescription>Applied, but couldn't save on this device.</AlertDescription></Alert>}
  </>;
}
