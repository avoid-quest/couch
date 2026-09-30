import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { SettingsRow } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deviceId, saveLocalDeviceName, useLocalDeviceName } from "@/session/device-id";
import { defaultDeviceName } from "../../../../shared/devices";

export function DeviceNameSettings() {
  const savedName = useLocalDeviceName();
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? savedName ?? defaultDeviceName(deviceId());
  const saving = useMutation({ mutationFn: saveLocalDeviceName, onSuccess: () => setDraft(null) });
  function save(event: FormEvent) {
    event.preventDefault();
    if (!saving.isPending) saving.mutate(name.trim());
  }
  return <>
    <SettingsRow label="Device name" htmlFor="local-device-name" description="This device uses the same name with every server.">
      <form className="flex w-full flex-wrap items-center gap-2" onSubmit={save}>
        <Input id="local-device-name" className="min-w-0 flex-1" value={name} onChange={event => setDraft(event.target.value)} maxLength={60} required disabled={saving.isPending} />
        <Button type="submit" variant="outline" disabled={saving.isPending || !name.trim() || name.trim() === savedName}>{saving.isPending ? "Saving…" : "Save"}</Button>
      </form>
    </SettingsRow>
    {saving.error && <Alert variant="destructive"><AlertDescription>{saving.error.message || "Couldn't save the name."}</AlertDescription></Alert>}
  </>;
}
