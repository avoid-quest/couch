import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { SettingsRow } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADMIN_ONLY, deviceName } from "@/copy";
import { apiSend, type ApiCredentials } from "@/api/client";

type Props = { credentials: ApiCredentials; connected: boolean; canWrite: boolean; name?: string };

// The name arrives with every session snapshot; saving it bumps the devices revision.
export function TvNameSettings({ credentials, connected, canWrite, name: savedName }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? savedName ?? "";
  const saving = useMutation({
    mutationFn: (value: string) => apiSend(credentials, "/api/settings", { name: value }),
    onSuccess: () => setDraft(null),
  });

  function save(event: FormEvent) {
    event.preventDefault();
    if (canWrite && !saving.isPending) saving.mutate(name.trim());
  }

  if (!canWrite) return <SettingsRow label="Name" description={ADMIN_ONLY}><span className="break-words text-sm" data-settings-tv-name>{deviceName(savedName)}</span></SettingsRow>;
  return <>
    <SettingsRow label="Name" htmlFor="tv-name" description="Shown to remotes.">
      <form className="flex w-full flex-wrap items-center gap-2" onSubmit={save}>
        <Input id="tv-name" className="min-w-0 flex-1" value={name} onChange={event => setDraft(event.target.value)} maxLength={60} required disabled={!connected || saving.isPending} />
        <Button type="submit" variant="outline" disabled={!connected || saving.isPending || !name.trim() || name.trim() === savedName}>{saving.isPending ? "Saving…" : "Save"}</Button>
      </form>
    </SettingsRow>
    {saving.error && <Alert variant="destructive"><AlertDescription>{saving.error.message || "Couldn't save the name."}</AlertDescription></Alert>}
  </>;
}
