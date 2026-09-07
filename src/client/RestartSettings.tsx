import { waitForRestart } from "./restart-request";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function RestartSettings({ credentials, connected }: { credentials: { origin: string; token: string }; connected: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const restart = async () => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setConfirm(false);
    setPending(true);
    setNotice("Saving progress before restarting…");
    const endpoint = `${credentials.origin}/api/settings/restart`;
    const headers = { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" };
    try {
      const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ confirmInterrupt: true }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Couch could not restart.");
      setNotice("Couch is restarting. Waiting for it to reconnect…");
      await waitForRestart(endpoint, headers, result.instanceId, controller.signal);
      setNotice("Couch restarted. Playback is stopped.");
    } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Restart failed."); }
    finally { operation.current = null; if (!controller.signal.aborted) setPending(false); }
  };
  return <div className="space-y-3">
    <p className="font-medium">Restart Couch</p>
    <p className="text-muted-foreground">Save viewing progress and restart the TV application. Paired remotes reconnect automatically. Playback stays stopped.</p>
    <Button variant="outline" className="min-h-11" disabled={!connected || pending} onClick={() => setConfirm(true)}>{pending ? "Restarting…" : "Restart Couch"}</Button>
    {notice && <p role="status">{notice}</p>}
    <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogHeader><DialogTitle>Restart Couch?</DialogTitle><DialogDescription>This interrupts current playback and briefly disconnects every remote. Your queue, preferences and pairing are kept.</DialogDescription></DialogHeader>
      <Button className="min-h-11" onClick={() => void restart()}>Confirm restart</Button><Button variant="outline" className="min-h-11" onClick={() => setConfirm(false)}>Cancel</Button>
    </DialogContent></Dialog>
  </div>;
}
