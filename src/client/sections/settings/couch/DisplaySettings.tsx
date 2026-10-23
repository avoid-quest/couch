import { SettingsRowsSkeleton } from "@/components/LoadingMedia";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend, type ApiCredentials } from "@/api/client";
import { displayQuery } from "@/api/settings";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { DisplayState } from "../../../../shared/display";

export function DisplaySettings({ credentials, connected, title }: { credentials: ApiCredentials; connected: boolean; title?: string }) {
  const queryClient = useQueryClient();
  const display = useQuery({ ...displayQuery(credentials), enabled: connected });
  const changeMutation = useMutation({
    mutationFn: ({ op, body }: { op: string; body: unknown }) => apiSend<DisplayState>(credentials, `/api/display/${op}`, body),
    onSuccess: result => queryClient.setQueryData(displayQuery(credentials).queryKey, result),
  });
  const state = connected ? display.data : undefined;
  const pending = changeMutation.isPending;
  const error = changeMutation.error ? changeMutation.error.message || "Couldn't change screen." : display.error ? display.error.message || "Couldn't read screens." : null;
  const expiresAt = state?.preview?.expiresAt;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  const change = (op: string, body: unknown) => { if (connected && !pending) changeMutation.mutate({ op, body }); };

  return (
    <SettingsSection title={title} description="Try a screen, then confirm within 20 seconds. Resolution and refresh rate stay the same.">
      {connected && display.isPending && <SettingsRowsSkeleton />}
      {state?.outputs.map(output => (
        <SettingsRow key={output.id} label={output.name} description={[
          state.current === output.id && "Current", state.saved === output.id && "Saved",
          !output.connected ? "Disconnected" : !output.width ? "Off in desktop settings" : `${output.width} × ${output.height}${output.refresh === null ? "" : `, ${output.refresh} Hz`}`,
        ].filter(Boolean).join(", ")}>
          <Button variant="outline" aria-label={`Try ${output.name}`} disabled={!connected || pending || !!state.preview || !output.connected || !output.width} onClick={() => change("preview", { output: output.id })}>Try</Button>
        </SettingsRow>
      ))}
      {state?.preview && <SettingsRow label="Keep this screen?" description={`Reverting in ${Math.max(0, Math.ceil((state.preview.expiresAt - now) / 1_000))} s.`}>
        <Button disabled={pending || !connected} onClick={() => change("confirm", { token: state.preview!.token })}>Keep</Button>
        <Button variant="outline" disabled={pending || !connected} onClick={() => change("cancel", { token: state.preview!.token })}>Revert</Button>
      </SettingsRow>}
      {state?.notice && <p role="status" className="text-sm text-muted-foreground">{state.notice}</p>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription>{display.error && !changeMutation.error && <AlertAction><Button variant="outline" size="sm" disabled={!connected || pending} onClick={() => void display.refetch()}>Try again</Button></AlertAction>}</Alert>}
    </SettingsSection>
  );
}
