import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type ApiCredentials } from "@/api/client";
import { controllersQuery } from "@/api/controllers";
import { PairingDialog } from "@/components/PairingDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type { Controller, ControllerIdentity } from "../../../../shared/controllers";

const formatSeen = (at: number | null) => at ? new Date(at).toLocaleString() : "never";

export function ConnectionsSettings({ credentials, connected, urls, identity, remoteControlEnabled, setRemoteControlEnabled, administratorClaimed, managedLan = false, lanError }: {
  credentials: ApiCredentials; connected: boolean; urls: string[]; identity: ControllerIdentity;
  remoteControlEnabled: boolean; setRemoteControlEnabled: (enabled: boolean) => void; administratorClaimed: boolean; managedLan?: boolean; lanError?: string | null;
}) {
  const queryClient = useQueryClient();
  const selfId = identity.controller?.id;
  const manager = identity.authority === "administrator" || identity.authority === "host";
  const controllers = useQuery({ ...controllersQuery(credentials), enabled: connected && manager });
  const setupCode = useQuery({
    queryKey: ["controllers", "setup-code"],
    enabled: connected && remoteControlEnabled && identity.authority === "host" && !administratorClaimed, retry: false,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(credentials, "/api/controllers/claim-code", { signal });
      return await response.json() as { code: string };
    },
  });
  const originDomain = useQuery({
    queryKey: ["settings", "origin-domain", credentials.origin],
    enabled: connected && manager && managedLan,
    queryFn: () => apiFetch(credentials, "/api/settings/origin-domain").then(response => response.json() as Promise<{ domain: string }>),
  });
  const [domain, setDomain] = useState("");
  const [domainPending, setDomainPending] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);
  useEffect(() => { if (originDomain.data) setDomain(originDomain.data.domain); }, [originDomain.data]);
  const [code, setCode] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [sharingPending, setSharingPending] = useState(false);
  const [sharingError, setSharingError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const pairingRef = useRef<HTMLButtonElement>(null);
  const pairUrl = urls[0];
  useEffect(() => { if (!remoteControlEnabled) setPairingOpen(false); }, [remoteControlEnabled]);

  async function claim(event: FormEvent) {
    event.preventDefault();
    if (claiming) return;
    setClaiming(true); setClaimError(null);
    try {
      await apiFetch(credentials, "/api/controllers/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim() }) });
      await queryClient.invalidateQueries({ queryKey: controllersQuery(credentials).queryKey });
    } catch (reason) { setClaimError(reason instanceof Error ? reason.message : "Could not claim administration."); }
    finally { setClaiming(false); }
  }

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
      if (action === "remove") setRemoving(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Request failed."); }
    finally { setPending(false); }
  }

  async function saveSharing(enabled: boolean) {
    if (sharingPending) return;
    setSharingPending(true); setSharingError(null);
    try {
      await apiFetch(credentials, "/api/settings/sharing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
      setRemoteControlEnabled(enabled);
    } catch (reason) { setSharingError(reason instanceof Error ? reason.message : "Could not save remote control."); }
    finally { setSharingPending(false); }
  }

  async function saveDomain(event: FormEvent) {
    event.preventDefault();
    if (domainPending) return;
    setDomainPending(true); setDomainError(null);
    try {
      await apiFetch(credentials, "/api/settings/origin-domain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain: domain.trim() }) });
      await originDomain.refetch();
    } catch (reason) { setDomainError(reason instanceof Error ? reason.message : "Could not save the local domain."); }
    finally { setDomainPending(false); }
  }

  return (
    <div className="space-y-8">
      {manager && <section aria-label="Pair a remote" className="space-y-3">
        <h3 className="font-medium">Pair a new remote</h3>
        <p className="text-sm text-muted-foreground">New devices pair as controllers. Promote one below to make it an administrator.</p>
        <Button ref={pairingRef} disabled={!connected || !pairUrl || !remoteControlEnabled} onClick={() => setPairingOpen(true)}>Pair a remote</Button>
        {!remoteControlEnabled && <p className="text-sm text-muted-foreground">Turn on remote control before pairing a device.</p>}
        <PairingDialog credentials={credentials} urls={urls} connected={connected} open={pairingOpen} onOpenChange={setPairingOpen} openerRef={pairingRef} />
      </section>}
      {identity.authority === "host" && <section aria-label="Remote control" className="space-y-3">
        <div className="flex items-center justify-between gap-4"><div><h3 className="font-medium">Allow remote control</h3><p className="text-sm text-muted-foreground">Let browsers and other Couch apps on your LAN pair with this computer.</p></div><Switch aria-label="Allow remote control" checked={remoteControlEnabled} disabled={sharingPending} onCheckedChange={saveSharing} /></div>
        {sharingError && <p role="alert">{sharingError}</p>}
      </section>}
      {manager && managedLan && <section aria-label="Local network address" className="space-y-3">
        <h3 className="font-medium">Local network address</h3>
        <p className="text-sm text-muted-foreground">Use a DNS name that resolves only to this computer’s selected LAN address. A bare name uses port 80; include Couch’s port when port 80 is unavailable.</p>
        <form className="flex flex-wrap items-end gap-3" onSubmit={event => void saveDomain(event)}>
          <div className="min-w-0 space-y-2"><Label htmlFor="origin-domain">Network address</Label><Input id="origin-domain" className="min-h-11" placeholder="http://couch.avoid.local" autoCapitalize="none" autoComplete="off" spellCheck={false} value={domain} onChange={event => setDomain(event.target.value)} disabled={!connected || domainPending || originDomain.isPending} /></div>
          <Button type="submit" className="min-h-11" disabled={!connected || domainPending || originDomain.isPending || domain.trim() === (originDomain.data?.domain ?? "")}>{domainPending ? "Saving…" : "Save address"}</Button>
        </form>
        {(originDomain.error || domainError) && <p role="alert" className="text-sm text-destructive">{domainError ?? (originDomain.error instanceof Error ? originDomain.error.message : "Could not read the local domain.")}</p>}
        {lanError && <p role="status" className="text-sm text-muted-foreground">{lanError}</p>}
      </section>}
      {identity.authority === "host" && remoteControlEnabled && !administratorClaimed && (
        <section aria-label="Administrator setup" data-administrator-setup className="space-y-3">
          <h3 className="font-medium">Set up your administrator remote</h3>
          {setupCode.isPending ? <p role="status" className="text-muted-foreground"><Spinner className="mr-2 inline size-3.5" />Loading setup code…</p>
            : setupCode.isError || !setupCode.data || !pairUrl ? <p role="alert">Could not load administrator setup. Check the LAN connection and try again.</p> : (
              <div className="min-w-0 space-y-2"><p className="text-sm text-muted-foreground">Pair the remote above, then enter this one-use administrator code.</p><a className="break-all underline" href={pairUrl}>{pairUrl}</a><p className="font-mono text-2xl tracking-wider" data-administrator-code>{setupCode.data.code}</p></div>
            )}
        </section>
      )}
      {identity.authority === "controller" && identity.claimAvailable && (
        <section aria-label="Claim administration" className="space-y-3">
          <h3 className="font-medium">Claim administration</h3>
          <form className="flex flex-wrap items-end gap-3" onSubmit={claim}>
            <div className="min-w-0 space-y-2"><Label htmlFor="administrator-code">Administrator code</Label>
              <Input id="administrator-code" className="min-h-11" value={code} onChange={event => setCode(event.target.value)} pattern="[0-9]{10}|[a-fA-F0-9]{32,256}" maxLength={256} required disabled={claiming} /></div>
            <Button className="min-h-11" type="submit" disabled={claiming || !/^(?:\d{10}|[a-f\d]{32,256})$/i.test(code.trim())}>{claiming ? "Claiming…" : "Claim administration"}</Button>
          </form>
          {claimError && <p role="alert">{claimError}</p>}
        </section>
      )}
      <section aria-label="Connected devices" className="space-y-3">
        <h3 className="font-medium">Devices</h3>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!manager ? <p className="text-sm text-muted-foreground">Claim administration to manage devices.</p>
          : controllers.isPending ? <p role="status" className="flex items-center gap-2 text-muted-foreground"><Spinner className="size-3.5" />Loading devices…</p>
          : controllers.isError ? <p role="alert">Could not load devices. <Button variant="outline" className="min-h-11" onClick={() => void controllers.refetch()}>Retry</Button></p>
          : <ul className="divide-y border-t border-border">
              {controllers.data.map(device => (
                <li key={device.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{device.name}{device.id === selfId && <span className="ml-2 font-normal text-muted-foreground">(this device)</span>}</p>
                    <p className="text-sm text-muted-foreground">{device.role === "administrator" ? "Administrator" : "Controller"} · last seen {formatSeen(device.lastSeenAt)}</p>
                  </div>
                  {device.id !== selfId && <>
                    <Button variant="outline" className="min-h-11" disabled={pending} onClick={() => void act(device, "role")}>{device.role === "administrator" ? "Make controller" : "Make administrator"}</Button>
                    {removing === device.id ? <span className="flex flex-wrap items-center gap-2"><span>Remove {device.name}?</span><Button variant="destructive" className="min-h-11" disabled={pending} onClick={() => void act(device, "remove")}>Remove</Button><Button variant="outline" className="min-h-11" disabled={pending} onClick={() => setRemoving(null)}>Cancel</Button></span> : <Button variant="destructive" className="min-h-11" disabled={pending} onClick={() => setRemoving(device.id)}>Remove</Button>}
                  </>}
                </li>
              ))}
            </ul>}
      </section>
    </div>
  );
}
