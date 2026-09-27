import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend, type ApiCredentials } from "@/api/client";
import { claimCodeQuery, controllersQuery } from "@/api/controllers";
import { lanNetworkQuery, originDomainQuery, type LanNetworkState } from "@/api/settings";
import { PairingDialog } from "@/components/PairingDialog";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TRY_AGAIN } from "@/copy";
import { clientDeviceName, rememberClientDeviceName } from "@/session/device-name";
import type { Controller, ControllerIdentity } from "../../../../shared/controllers";

const formatSeen = (at: number | null) => at ? `Seen ${new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Never seen";

export function ConnectionsSettings({ credentials, connected, urls, identity, remoteControlEnabled, administratorClaimed, managedLan = false, lanError, hostName = "Couch" }: {
  credentials: ApiCredentials; connected: boolean; urls: string[]; identity: ControllerIdentity;
  remoteControlEnabled: boolean; administratorClaimed: boolean; managedLan?: boolean; lanError?: string | null; hostName?: string;
}) {
  const queryClient = useQueryClient();
  const selfId = identity.controller?.id;
  const [savedDeviceName, setSavedDeviceName] = useState<{ key: string; name: string } | null>(null);
  const [deviceNameDraft, setDeviceNameDraft] = useState<string | null>(null);
  const deviceKey = `${credentials.origin}:${selfId ?? "host"}`;
  useEffect(() => setDeviceNameDraft(null), [deviceKey]);
  const currentDeviceName = savedDeviceName?.key === deviceKey ? savedDeviceName.name : selfId ? clientDeviceName(identity.controller?.name) : hostName;
  const deviceName = deviceNameDraft ?? currentDeviceName;
  const rename = useMutation({
    mutationFn: (name: string) => selfId
      ? apiSend(credentials, `/api/controllers/${selfId}/name`, { name })
      : apiSend(credentials, "/api/settings", { name }),
    onSuccess: (_result, name) => { rememberClientDeviceName(name); setSavedDeviceName({ key: deviceKey, name }); setDeviceNameDraft(null); refreshControllers(); },
  });
  const host = identity.authority === "host";
  const manager = identity.authority === "administrator" || host;
  const controllers = useQuery({ ...controllersQuery(credentials), enabled: connected && manager });
  const setupCode = useQuery({ ...claimCodeQuery(credentials), enabled: connected && remoteControlEnabled && host && !administratorClaimed });
  const originDomain = useQuery({ ...originDomainQuery(credentials), enabled: connected && manager && managedLan });
  const lanNetwork = useQuery({ ...lanNetworkQuery(credentials), enabled: connected && host && managedLan });
  const [domainDraft, setDomainDraft] = useState<string | null>(null);
  const domain = domainDraft ?? originDomain.data?.domain ?? "";
  const [code, setCode] = useState("");
  const [pairingOpen, setPairingOpen] = useState(false);
  const [removing, setRemoving] = useState<Controller | null>(null);
  const pairingRef = useRef<HTMLButtonElement>(null);
  const pairUrl = urls[0];
  const refreshControllers = () => queryClient.invalidateQueries({ queryKey: controllersQuery(credentials).queryKey });
  const claiming = useMutation({ mutationFn: (value: string) => apiSend(credentials, "/api/controllers/claim", { code: value }), onSuccess: refreshControllers });
  const deviceChange = useMutation({
    mutationFn: ({ target, action }: { target: Controller; action: "role" | "remove" }) => action === "role"
      ? apiSend(credentials, `/api/controllers/${target.id}/role`, { role: target.role === "administrator" ? "controller" : "administrator" })
      : apiSend(credentials, `/api/controllers/${target.id}`, undefined, "DELETE"),
    onSuccess: refreshControllers,
  });
  // The server bumps the controllers revision, which refreshes remoteControlEnabled.
  const sharing = useMutation({ mutationFn: (enabled: boolean) => apiSend(credentials, "/api/settings/sharing", { enabled }) });
  const chooseNetwork = useMutation({
    mutationFn: (address: string) => apiSend<LanNetworkState>(credentials, "/api/settings/lan-network", { address: address === "auto" ? null : address }),
    onSuccess: result => queryClient.setQueryData(lanNetworkQuery(credentials).queryKey, result),
  });
  const saveDomain = useMutation({
    mutationFn: (value: string) => apiSend<{ domain: string }>(credentials, "/api/settings/origin-domain", { domain: value }),
    onSuccess: result => { queryClient.setQueryData(originDomainQuery(credentials).queryKey, result); setDomainDraft(null); },
  });
  const message = (error: Error | null, fallback: string) => error ? error.message || fallback : null;
  const pending = deviceChange.isPending;
  const act = (target: Controller, action: "role" | "remove") => { if (!pending) deviceChange.mutate({ target, action }); };
  function claim(event: FormEvent) {
    event.preventDefault();
    if (!claiming.isPending) claiming.mutate(code.trim());
  }
  function submitDomain(event: FormEvent) {
    event.preventDefault();
    if (!saveDomain.isPending) saveDomain.mutate(domain.trim());
  }
  function submitDeviceName(event: FormEvent) {
    event.preventDefault();
    const name = deviceName.trim();
    if (rename.isPending || !name || name === currentDeviceName) return;
    rename.mutate(name);
  }

  return <>
    <SettingsSection title="This device">
      <SettingsRow label="Name" htmlFor="device-name" description="Shown when this device connects or plays.">
        <form className="flex w-full flex-wrap items-center gap-2" onSubmit={submitDeviceName}>
          <Input id="device-name" className="min-w-0 flex-1" value={deviceName} maxLength={60} required onChange={event => setDeviceNameDraft(event.target.value)} disabled={!connected || rename.isPending} />
          <Button type="submit" variant="outline" disabled={!connected || rename.isPending || !deviceName.trim() || deviceName.trim() === currentDeviceName}>{rename.isPending ? "Renaming…" : "Rename"}</Button>
        </form>
      </SettingsRow>
      {rename.error && <Alert variant="destructive"><AlertDescription>{message(rename.error, "Couldn't rename this device.")}</AlertDescription></Alert>}
    </SettingsSection>
    {manager && <SettingsSection>
      {host && <SettingsRow label="Allow remotes" description="Phones and computers on your network can pair.">
        <Switch aria-label="Allow remotes" checked={sharing.isPending ? sharing.variables : remoteControlEnabled} disabled={sharing.isPending} onCheckedChange={enabled => { if (!sharing.isPending) sharing.mutate(enabled); }} />
      </SettingsRow>}
      {host && managedLan && <SettingsRow label="Home network" description={lanError || (lanNetwork.data?.active ? `Remotes connect at ${lanNetwork.data.active}.` : "Choose the network your remotes use.")}>
        <Select value={lanNetwork.data?.selected ?? "auto"} disabled={!connected || !lanNetwork.data || chooseNetwork.isPending} onValueChange={value => chooseNetwork.mutate(value)}>
          <SelectTrigger aria-label="Home network" className="w-full max-w-sm"><SelectValue placeholder="Detect automatically" /></SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="auto">Detect automatically</SelectItem>
            {lanNetwork.data?.networks.map(network => <SelectItem key={`${network.name}:${network.address}`} value={network.address}>{network.name} · {network.address}</SelectItem>)}
          </SelectContent>
        </Select>
      </SettingsRow>}
      {chooseNetwork.error && <Alert variant="destructive"><AlertDescription>{message(chooseNetwork.error, "Couldn't choose the network.")}</AlertDescription></Alert>}
      <SettingsRow label="New remote" description={remoteControlEnabled ? "Scan a code with your phone." : host ? "Turn on Allow remotes first." : `Turn on Allow remotes on ${hostName} first.`}>
        <Button ref={pairingRef} variant="outline" disabled={!connected || !pairUrl || !remoteControlEnabled} onClick={() => setPairingOpen(true)}>Pair a remote</Button>
      </SettingsRow>
      {managedLan && <SettingsRow label="Network address" htmlFor="origin-domain" description={lanError || `A name that points to ${hostName}. Add a port if 80 is taken.`}>
        <form className="flex w-full flex-wrap items-center gap-2" onSubmit={submitDomain}>
          <Input id="origin-domain" className="min-w-0 flex-1" placeholder="http://couch.local" autoCapitalize="none" autoComplete="off" spellCheck={false} value={domain} onChange={event => setDomainDraft(event.target.value)} disabled={!connected || saveDomain.isPending || originDomain.isPending} />
          <Button type="submit" variant="outline" disabled={!connected || saveDomain.isPending || originDomain.isPending || domain.trim() === (originDomain.data?.domain ?? "")}>{saveDomain.isPending ? "Saving…" : "Save"}</Button>
        </form>
      </SettingsRow>}
      {sharing.error && <Alert variant="destructive"><AlertDescription>{message(sharing.error, "Couldn't change Allow remotes.")}</AlertDescription></Alert>}
      {(saveDomain.error || originDomain.error) && <Alert variant="destructive"><AlertDescription>{message(saveDomain.error, "Couldn't save the address.") ?? message(originDomain.error, "Couldn't read the address.")}</AlertDescription>{originDomain.error && !saveDomain.error && <AlertAction><Button variant="outline" size="sm" disabled={!connected} onClick={() => void originDomain.refetch()}>Try again</Button></AlertAction>}</Alert>}
      <PairingDialog credentials={credentials} urls={urls} connected={connected} open={pairingOpen && remoteControlEnabled} onOpenChange={setPairingOpen} openerRef={pairingRef} />
    </SettingsSection>}
    {host && remoteControlEnabled && !administratorClaimed && (
      <SettingsSection title="Make a remote the admin" description="Pair a remote, then enter this one-time code on it." data-administrator-setup>
        <div className="flex min-w-0 flex-col gap-1">
          {setupCode.isPending ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading…</p>
            : setupCode.isError || !setupCode.data || !pairUrl ? <Alert variant="destructive"><AlertDescription>Couldn't load the admin code.</AlertDescription><AlertAction><Button variant="outline" size="sm" disabled={!connected || setupCode.isFetching} onClick={() => void setupCode.refetch()}>Try again</Button></AlertAction></Alert>
            : <><p className="font-mono text-3xl tracking-wider" data-administrator-code>{setupCode.data.code}</p><a className="break-all text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" href={pairUrl}>{pairUrl}</a></>}
        </div>
      </SettingsSection>
    )}
    {identity.authority === "controller" && identity.claimAvailable && (
      <SettingsSection data-admin-claim>
        <SettingsRow label="Admin code" htmlFor="administrator-code" description={`Shown on ${hostName} in Settings → Devices.`}>
          <form className="flex w-full flex-wrap items-center gap-2" onSubmit={claim}>
            <Input id="administrator-code" className="min-w-0 flex-1" value={code} onChange={event => setCode(event.target.value)} pattern="[0-9]{10}|[a-fA-F0-9]{32,256}" maxLength={256} required disabled={claiming.isPending} />
            <Button type="submit" disabled={claiming.isPending || !/^(?:\d{10}|[a-f\d]{32,256})$/i.test(code.trim())}>{claiming.isPending ? "Checking…" : "Become admin"}</Button>
          </form>
        </SettingsRow>
        {claiming.error && <Alert variant="destructive"><AlertDescription>{message(claiming.error, "Couldn't make you admin. Check the code.")}</AlertDescription></Alert>}
      </SettingsSection>
    )}
    {manager && <SettingsSection title="Paired remotes" data-remotes>
      {controllers.isPending ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading…</p>
        : controllers.isError ? <Alert variant="destructive"><AlertDescription>Couldn't load remotes.</AlertDescription><AlertAction><Button variant="outline" size="sm" onClick={() => void controllers.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>
        : !controllers.data.length ? <Empty className="py-0"><EmptyHeader><EmptyDescription>No remotes yet. Use Pair a remote to connect one.</EmptyDescription></EmptyHeader></Empty>
        : controllers.data.map(device => (
            <SettingsRow key={device.id} data-remote={device.id} label={<>{device.name}{device.id === selfId && <span className="text-muted-foreground"> (this remote)</span>}</>}
              description={[device.role === "administrator" && "Admin", formatSeen(device.lastSeenAt)].filter(Boolean).join(" · ")}>
              {device.id !== selfId && <>
                <Button variant="outline" disabled={pending} onClick={() => act(device, "role")}>{device.role === "administrator" ? "Remove admin" : "Make admin"}</Button>
                <Button variant="ghost" disabled={pending} onClick={() => setRemoving(device)}>Remove</Button>
              </>}
            </SettingsRow>
          ))}
      {deviceChange.error && <Alert variant="destructive"><AlertDescription>{message(deviceChange.error, "Couldn't update remote. Try again.")}</AlertDescription></Alert>}
    </SettingsSection>}
    <AlertDialog open={!!removing} onOpenChange={open => { if (!open) setRemoving(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
          <AlertDialogDescription>It will need to pair again.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => removing && act(removing, "remove")}>Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
