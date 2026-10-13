import { useMutation } from "@tanstack/react-query";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { localDeviceSharing, saveLocalDeviceSharing, useLocalDeviceSharing } from "@/session/device-id";
import type { DeviceSharing } from "../../../../shared/device-sharing";

export function DeviceSharingSettings() {
  const sharing = useLocalDeviceSharing();
  const saving = useMutation({ mutationFn: ({ capability, enabled }: { capability: keyof DeviceSharing; enabled: boolean }) => saveLocalDeviceSharing({ ...localDeviceSharing(), [capability]: enabled }) });
  const choices: Array<{ capability: keyof DeviceSharing; label: string; description: string }> = [
    { capability: "audio", label: "Let other devices use speakers", description: "Other devices can play through this device's speakers and set their volume." },
    { capability: "video", label: "Let other devices use screen", description: "Other devices can show video on this device's screen." },
  ];
  return <SettingsSection title="Other devices" description="Off by default when you join another server. Playing here yourself and sharing a source from this device don't need these.">
    {choices.map(({ capability, label, description }) => <SettingsRow key={capability} label={label} description={description}>
      <Switch aria-label={label} checked={sharing[capability]} disabled={saving.isPending} onCheckedChange={enabled => saving.mutate({ capability: capability, enabled })} />
    </SettingsRow>)}
    {saving.error && <Alert variant="destructive"><AlertDescription>{saving.error.message}</AlertDescription></Alert>}
  </SettingsSection>;
}
