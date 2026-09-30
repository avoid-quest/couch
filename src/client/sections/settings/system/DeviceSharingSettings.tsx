import { useMutation } from "@tanstack/react-query";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { localDeviceSharing, saveLocalDeviceSharing, useLocalDeviceSharing } from "@/session/device-id";
import type { DeviceSharing } from "../../../../shared/device-identity";

export function DeviceSharingSettings() {
  const sharing = useLocalDeviceSharing();
  const saving = useMutation({ mutationFn: ({ capability, enabled }: { capability: keyof DeviceSharing; enabled: boolean }) => saveLocalDeviceSharing({ ...localDeviceSharing(), [capability]: enabled }) });
  const choices: Array<{ capability: keyof DeviceSharing; label: string; description: string }> = [
    { capability: "audio", label: "Share audio", description: "Let other devices play through this device's speakers and control their volume." },
    { capability: "video", label: "Share video", description: "Let other devices play video on this device's screen." },
  ];
  return <SettingsSection title="Sharing this device" description="Off by default when you join another server. You can always play on your own device.">
    {choices.map(({ capability, label, description }) => <SettingsRow key={capability} label={label} description={description}>
      <Switch aria-label={label} checked={sharing[capability]} disabled={saving.isPending} onCheckedChange={enabled => saving.mutate({ capability: capability, enabled })} />
    </SettingsRow>)}
    {saving.error && <Alert variant="destructive"><AlertDescription>{saving.error.message}</AlertDescription></Alert>}
  </SettingsSection>;
}
