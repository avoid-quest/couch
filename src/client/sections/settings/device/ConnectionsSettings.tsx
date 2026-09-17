import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type ApiCredentials } from "@/api/client";
import { controllersQuery } from "@/api/controllers";
import { SetupQr } from "@/components/SetupQr";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ConnectionInfo } from "../../../../shared/protocol";
import type { Controller } from "../../../../shared/controllers";

const formatSeen = (at: number | null) => at ? new Date(at).toLocaleString() : "never";

export function ConnectionsSettings({ credentials, connected, host, selfId }: { credentials: ApiCredentials; connected: boolean; host: ConnectionInfo | null; selfId: string | null }) {
  const queryClient = useQueryClient();
  const controllers = useQuery(controllersQuery(credentials));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pairUrl = host?.urls[0];

  async function act(device: Controller, action: "role" | "remove") {
    if (pending) return;
    setPending(true); setError(null);
    try {
      await apiFetch(credentials, `/api/controllers/${device.id}${action === "role" ? "/role" : ""}`, {
        method: action === "role" ? "POST" : "DELETE",
        headers: action === "role" ? { "Content-Type": "application/json" } : undefined,
        body: action === "role" ? JSON.stringify({ role: device.role === "administrator" ? "controller" : "administrator" }) : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: controllersQuery(credentials).queryKey });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Request failed."); }
    finally { setPending(false); }
  }

  return (
    <div className="space-y-8">
      <section aria-label="Pair a remote" className="flex flex-wrap items-start gap-6">
        {connected && pairUrl
          ? <>
              <SetupQr url={pairUrl} credentials={credentials} />
              <div className="min-w-0 space-y-2">
                <h3 className="font-medium">Pair a new remote</h3>
                <p className="text-sm text-muted-foreground">New devices pair as controllers. Promote one below to make it an administrator.</p>
                <p className="pairing-display"><span>Pairing code</span><strong>{host!.pairingCode}</strong></p>
              </div>
            </>
          : <p role="status" className="text-muted-foreground">{connected ? "No network address available. Connect the TV to the network and reload." : "Reconnecting to the TV. The pairing code returns when connected."}</p>}
      </section>
      <section aria-label="Connected devices" className="space-y-3">
        <h3 className="font-medium">Devices</h3>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {controllers.isPending ? <p role="status" className="flex items-center gap-2 text-muted-foreground"><Spinner className="size-3.5" />Loading devices…</p>
          : controllers.isError ? <p role="alert">Could not load devices. <Button variant="outline" className="min-h-11" onClick={() => void controllers.refetch()}>Retry</Button></p>
          : <ul className="divide-y rounded-md border">
              {controllers.data.map(device => (
                <li key={device.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{device.name}{device.id === selfId && <span className="ml-2 font-normal text-muted-foreground">(this device)</span>}</p>
                    <p className="text-sm text-muted-foreground">{device.role === "administrator" ? "Administrator" : "Controller"} · last seen {formatSeen(device.lastSeenAt)}</p>
                  </div>
                  {device.id !== selfId && <>
                    <Button variant="outline" className="min-h-11" disabled={pending} onClick={() => void act(device, "role")}>{device.role === "administrator" ? "Make controller" : "Make administrator"}</Button>
                    <Button variant="destructive" className="min-h-11" disabled={pending} onClick={() => void act(device, "remove")}>Remove</Button>
                  </>}
                </li>
              ))}
            </ul>}
      </section>
    </div>
  );
}
