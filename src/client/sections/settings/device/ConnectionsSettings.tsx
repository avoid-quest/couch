import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend, type ApiCredentials } from "@/api/client";
import { claimCodeQuery, devicesQuery } from "@/api/devices";
import { originDomainQuery } from "@/api/settings";
import { PairingDialog } from "@/components/PairingDialog";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { TRY_AGAIN } from "@/copy";
import type { Device, DeviceIdentity } from "../../../../shared/devices";

const formatSeen = (at: number | null) => at ? `Seen ${new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Never seen";

export function ConnectionsSettings({ credentials, connected, urls, identity, remoteControlEnabled, administratorClaimed, managedLan = false, lanError, hostName = "Couch", online = new Set() }: {
  credentials: ApiCredentials; connected: boolean; urls: string[]; identity: DeviceIdentity;
  remoteControlEnabled: boolean; administratorClaimed: boolean; managedLan?: boolean; lanError?: string | null; hostName?: string;
  /** Devices connected now, from the session state. */
  online?: ReadonlySet<string>;
}) {
  const queryClient = useQueryClient();
  const selfId = identity.device?.id;
  const host = identity.authority === "host";
  const manager = identity.authority === "administrator" || host;
  const devices = useQuery({ ...devicesQuery(credentials), enabled: connected });
  const setupCode = useQuery({ ...claimCodeQuery(credentials), enabled: connected && remoteControlEnabled && host && !administratorClaimed });
  const originDomain = useQuery({ ...originDomainQuery(credentials), enabled: connected && manager && managedLan });
  const [domainDraft, setDomainDraft] = useState<string | null>(null);
  const domain = domainDraft ?? originDomain.data?.domain ?? "";
  const [code, setCode] = useState("");
  const [pairingOpen, setPairingOpen] = useState(false);
  const [removing, setRemoving] = useState<Device | null>(null);
  const [renaming, setRenaming] = useState<Device | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const pairingRef = useRef<HTMLButtonElement>(null);
  const pairUrl = urls[0];
  const refreshDevices = () => queryClient.invalidateQueries({ queryKey: devicesQuery(credentials).queryKey });
  const claiming = useMutation({ mutationFn: (value: string) => apiSend(credentials, "/api/devices/claim", { code: value }), onSuccess: refreshDevices });
  const deviceChange = useMutation({
    mutationFn: ({ target, action }: { target: Device; action: "role" | "remove" }) => action === "role"
      ? apiSend(credentials, `/api/devices/${target.id}/role`, { role: target.role === "administrator" ? "controller" : "administrator" })
      : apiSend(credentials, `/api/devices/${target.id}`, undefined, "DELETE"),
    onSuccess: refreshDevices,
  });
  const rename = useMutation({
    mutationFn: ({ target, name }: { target: Device; name: string }) => apiSend(credentials, `/api/devices/${target.id}/name`, { name }),
    onSuccess: () => { setRenaming(null); void refreshDevices(); },
  });
  // The server bumps the devices revision, which refreshes remoteControlEnabled.
  const sharing = useMutation({ mutationFn: (enabled: boolean) => apiSend(credentials, "/api/settings/sharing", { enabled }) });
  const saveDomain = useMutation({
    mutationFn: (value: string) => apiSend<{ domain: string }>(credentials, "/api/settings/origin-domain", { domain: value }),
    onSuccess: result => { queryClient.setQueryData(originDomainQuery(credentials).queryKey, result); setDomainDraft(null); },
  });
  const message = (error: Error | null, fallback: string) => error ? error.message || fallback : null;
  const pending = deviceChange.isPending;
  const act = (target: Device, action: "role" | "remove") => { if (!pending) deviceChange.mutate({ target, action }); };
  const startRename = (target: Device) => { rename.reset(); setNameDraft(target.name); setRenaming(target); };
  function submitName(event: FormEvent) {
    event.preventDefault();
    if (renaming && !rename.isPending) rename.mutate({ target: renaming, name: nameDraft.trim() });
  }
  function claim(event: FormEvent) {
    event.preventDefault();
    if (!claiming.isPending) claiming.mutate(code.trim());
  }
  function submitDomain(event: FormEvent) {
    event.preventDefault();
    if (!saveDomain.isPending) saveDomain.mutate(domain.trim());
  }

  // Sharing and pairing, then the paired Devices (like Bluetooth), then the rare admin handover; the Couch choice with Forget follows on the page.
  return <>
    {manager && <SettingsSection>
      {host && <SettingsRow label="Share on network" description="Phones, browsers and other computers on your network can pair and play.">
        <Switch aria-label="Share on network" checked={sharing.isPending ? sharing.variables : remoteControlEnabled} disabled={sharing.isPending} onCheckedChange={enabled => { if (!sharing.isPending) sharing.mutate(enabled); }} />
      </SettingsRow>}
      <SettingsRow label="New device" description={remoteControlEnabled ? "Show a code to scan or type on the new device." : host ? "Turn on Share on network first." : `Turn on Share on network on ${hostName} first.`}>
        <Button ref={pairingRef} variant="outline" disabled={!connected || !pairUrl || !remoteControlEnabled} onClick={() => setPairingOpen(true)}>Pair a device</Button>
      </SettingsRow>
      {managedLan && <SettingsRow label="Network address" htmlFor="origin-domain" description={lanError || `A name that points to ${hostName}. Add a port if 80 is taken.`}>
        <form className="flex w-full flex-wrap items-center gap-2" onSubmit={submitDomain}>
          <Input id="origin-domain" className="min-w-0 flex-1" placeholder="http://couch.local" autoCapitalize="none" autoComplete="off" spellCheck={false} value={domain} onChange={event => setDomainDraft(event.target.value)} disabled={!connected || saveDomain.isPending || originDomain.isPending} />
          <Button type="submit" variant="outline" disabled={!connected || saveDomain.isPending || originDomain.isPending || domain.trim() === (originDomain.data?.domain ?? "")}>{saveDomain.isPending ? "Saving…" : "Save"}</Button>
        </form>
      </SettingsRow>}
      {sharing.error && <Alert variant="destructive"><AlertDescription>{message(sharing.error, "Couldn't change Share on network.")}</AlertDescription></Alert>}
      {(saveDomain.error || originDomain.error) && <Alert variant="destructive"><AlertDescription>{message(saveDomain.error, "Couldn't save the address.") ?? message(originDomain.error, "Couldn't read the address.")}</AlertDescription>{originDomain.error && !saveDomain.error && <AlertAction><Button variant="outline" size="sm" disabled={!connected} onClick={() => void originDomain.refetch()}>Try again</Button></AlertAction>}</Alert>}
      <PairingDialog credentials={credentials} urls={urls} connected={connected} open={pairingOpen && remoteControlEnabled} onOpenChange={setPairingOpen} openerRef={pairingRef} />
    </SettingsSection>}
    <SettingsSection data-devices>
      {devices.isPending ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading…</p>
        : devices.isError ? <Alert variant="destructive"><AlertDescription>Couldn't load devices.</AlertDescription><AlertAction><Button variant="outline" size="sm" onClick={() => void devices.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>
        : !devices.data.length ? <Empty className="py-0"><EmptyHeader><EmptyDescription>No devices yet. Use Pair a device to connect one.</EmptyDescription></EmptyHeader></Empty>
        : devices.data.map(device => (
            <SettingsRow key={device.id} data-device={device.id} label={<>{device.name}{device.id === selfId && <span className="text-muted-foreground"> (this device)</span>}</>}
              description={device.role === "host" ? "Runs this Couch" : [device.role === "administrator" && "Admin", online.has(device.id) ? "Online" : formatSeen(device.lastSeenAt)].filter(Boolean).join(" · ")}>
              {!host && manager && device.role === "host" && <Button variant="outline" disabled={!connected || rename.isPending} onClick={() => startRename(device)}>Rename</Button>}
              {manager && device.role !== "host" && device.id !== selfId && <>
                <Button variant="outline" disabled={pending} onClick={() => act(device, "role")}>{device.role === "administrator" ? "Remove admin" : "Make admin"}</Button>
                <Button variant="ghost" disabled={pending} onClick={() => setRemoving(device)}>Remove</Button>
              </>}
            </SettingsRow>
          ))}
      {deviceChange.error && <Alert variant="destructive"><AlertDescription>{message(deviceChange.error, "Couldn't update the device. Try again.")}</AlertDescription></Alert>}
    </SettingsSection>
    {host && remoteControlEnabled && !administratorClaimed && (
      <SettingsSection title="Make a device the admin" description="Pair a device, then enter this one-time code on it." data-administrator-setup>
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
    <Dialog open={!!renaming} onOpenChange={open => { if (!open && !rename.isPending) setRenaming(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Rename {renaming?.name}</DialogTitle><DialogDescription>Every device shows the new name.</DialogDescription></DialogHeader>
        <form className="grid gap-4" onSubmit={submitName}>
          <Field><FieldLabel htmlFor="device-rename">Name</FieldLabel><Input id="device-rename" autoFocus autoComplete="off" maxLength={60} value={nameDraft} onChange={event => setNameDraft(event.target.value)} required disabled={rename.isPending} /></Field>
          {rename.error && <Alert variant="destructive"><AlertDescription>{message(rename.error, "Couldn't rename the device.")}</AlertDescription></Alert>}
          <DialogFooter><Button type="button" variant="ghost" disabled={rename.isPending} onClick={() => setRenaming(null)}>Cancel</Button><Button type="submit" disabled={!connected || rename.isPending || !nameDraft.trim() || nameDraft.trim() === renaming?.name}>{rename.isPending ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
