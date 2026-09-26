import { waitForRestart } from "../../../restart-request";
import { useEffect, useRef, useState } from "react";
import { SettingsRow } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function RestartSettings({ credentials, connected, hostName = "Couch" }: { credentials: { origin: string; token: string }; connected: boolean; hostName?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const restart = async () => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError(null);
    const endpoint = `${credentials.origin}/api/settings/restart`;
    const headers = { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" };
    try {
      const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ confirmInterrupt: true }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Couldn't restart.");
      await waitForRestart(endpoint, headers, result.instanceId, controller.signal);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Couldn't restart."); }
    finally { operation.current = null; if (!controller.signal.aborted) setPending(false); }
  };
  return <>
    <SettingsRow label={`Restart ${hostName}`} description="Playback stops and remotes briefly disconnect.">
      <AlertDialog>
        <AlertDialogTrigger asChild><Button variant="outline" disabled={!connected || pending}>Restart</Button></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart {hostName}?</AlertDialogTitle>
            <AlertDialogDescription>Playback stops and remotes briefly disconnect. Up next, settings and pairing are kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void restart()}>Restart</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsRow>
    {pending && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Restarting…</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </>;
}
