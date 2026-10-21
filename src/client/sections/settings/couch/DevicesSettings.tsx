import { SettingsRowsSkeleton } from "@/components/LoadingMedia";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend, type ApiCredentials } from "@/api/client";
import { claimCodeQuery, devicesQuery } from "@/api/devices";
import { PairingDialog } from "@/components/PairingDialog";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TRY_AGAIN } from "@/copy";
import type { Device, DeviceIdentity } from "../../../../shared/devices";
import { RenameCouch } from "./RenameCouch";

const formatSeen = (at: number | null) => at ? `Seen ${new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Never seen";

export function DevicesSettings({ credentials, connected, urls, identity, remoteControlEnabled, administratorClaimed, hostName = "Couch", online = new Set() }: {
  credentials: ApiCredentials; connected: boolean; urls: string[]; identity: DeviceIdentity;
  remoteControlEnabled: boolean; administratorClaimed: boolean; hostName?: string;
  /** Devices connected now, from the session state. */
  online?: ReadonlySet<string>;
}) {
  const queryClient = useQueryClient();
  const selfId = identity.device?.id;
  const host = identity.authority === "host";
  const manager = identity.authority === "administrator" || host;
  const devices = useQuery({ ...devicesQuery(credentials), enabled: connected });
  // The first device paired becomes the admin, so the admin code is useful only once devices are paired.
  const paired = devices.data?.some(device => device.role !== "host");
  const setupCode = useQuery({ ...claimCodeQuery(credentials), enabled: connected && remoteControlEnabled && host && !administratorClaimed && !!paired });
  const [code, setCode] = useState("");
  const [pairingOpen, setPairingOpen] = useState(false);
  const [removing, setRemoving] = useState<Device | null>(null);
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
  const message = (error: Error | null, fallback: string) => error ? error.message || fallback : null;
  const pending = deviceChange.isPending;
  const act = (target: Device, action: "role" | "remove") => { if (!pending) deviceChange.mutate({ target, action }); };
  function claim(event: FormEvent) {
    event.preventDefault();
    if (!claiming.isPending) claiming.mutate(code.trim());
  }

  // Pairing, then the paired Devices (like Bluetooth), then the rare admin handover. Pairing heads the list's rows:
  // an untitled section of its own would leave a gap that reads as an empty row.
  return <>
    <SettingsSection data-devices>
      <SettingsRow label="New device" description={!manager ? "Only an admin can pair devices." : !remoteControlEnabled ? "Turn on Share on network below first."
        : `Show a code to scan or type on the new device.${host && !administratorClaimed && paired === false ? " The first device you pair becomes the admin." : ""}`}>
        {manager && <Button ref={pairingRef} data-page-first variant="outline" disabled={!connected || !pairUrl || !remoteControlEnabled} onClick={() => setPairingOpen(true)}>Pair a device</Button>}
      </SettingsRow>
      {manager && <PairingDialog credentials={credentials} urls={urls} connected={connected} open={pairingOpen && remoteControlEnabled} onOpenChange={setPairingOpen} openerRef={pairingRef} />}
      {devices.isSuccess && !host && manager && !devices.data.some(device => device.role === "host") && <SettingsRow label={hostName} description="Runs this Couch">
        <RenameCouch credentials={credentials} connected={connected} name={hostName} onRenamed={refreshDevices} />
      </SettingsRow>}
      {devices.isPending ? <SettingsRowsSkeleton />
        : devices.isError ? <Alert variant="destructive"><AlertDescription>Couldn't load devices.</AlertDescription><AlertAction><Button variant="outline" size="sm" onClick={() => void devices.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>
        : !devices.data.length ? <Empty className="py-0"><EmptyHeader><EmptyDescription>No devices yet. Use Pair a device to connect one.</EmptyDescription></EmptyHeader></Empty>
        : devices.data.map(device => (
            <SettingsRow key={device.id} data-device={device.id} label={<>{device.name}{device.id === selfId && <span className="text-muted-foreground"> (this device)</span>}</>}
              description={device.role === "host" ? "Runs this Couch" : [device.role === "administrator" && "Admin", online.has(device.id) ? "Online" : formatSeen(device.lastSeenAt)].filter(Boolean).join(" · ")}>
              {!host && manager && device.role === "host" && <RenameCouch credentials={credentials} connected={connected} name={device.name} onRenamed={refreshDevices} />}
              {manager && device.role !== "host" && device.id !== selfId && <>
                <Button variant="outline" disabled={pending} onClick={() => act(device, "role")}>{device.role === "administrator" ? "Remove admin" : "Make admin"}</Button>
                <Button variant="ghost" disabled={pending} onClick={() => setRemoving(device)}>Remove</Button>
              </>}
            </SettingsRow>
          ))}
      {deviceChange.error && <Alert variant="destructive"><AlertDescription>{message(deviceChange.error, "Couldn't update the device. Try again.")}</AlertDescription></Alert>}
    </SettingsSection>
    {host && remoteControlEnabled && !administratorClaimed && paired && (
      <SettingsSection title="Make a device the admin" description="Enter this one-time code on a paired device." data-administrator-setup>
        <div className="flex min-w-0 flex-col gap-1">
          {setupCode.isPending ? <SettingsRowsSkeleton />
            : setupCode.isError || !setupCode.data || !pairUrl ? <Alert variant="destructive"><AlertDescription>Couldn't load the admin code.</AlertDescription><AlertAction><Button variant="outline" size="sm" disabled={!connected || setupCode.isFetching} onClick={() => void setupCode.refetch()}>Try again</Button></AlertAction></Alert>
            : <><p className="font-mono text-3xl tracking-wider" data-administrator-code>{setupCode.data.code}</p><a className="break-all text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" href={pairUrl}>{pairUrl}</a></>}
        </div>
      </SettingsSection>
    )}
    {identity.authority === "controller" && identity.claimAvailable && (
      <SettingsSection data-admin-claim>
        <SettingsRow label="Admin code" htmlFor="administrator-code" description={`Shown on ${hostName} in Settings → Devices & network.`}>
          <form className="flex w-full flex-wrap items-center gap-2" onSubmit={claim}>
            <Input id="administrator-code" className="min-w-0 flex-1" value={code} onChange={event => setCode(event.target.value)} pattern="[0-9]{10}|[a-fA-F0-9]{32,256}" maxLength={256} required disabled={claiming.isPending} />
            <Button type="submit" disabled={claiming.isPending || !/^(?:\d{10}|[a-f\d]{32,256})$/i.test(code.trim())}>{claiming.isPending ? "Checking…" : "Become admin"}</Button>
          </form>
        </SettingsRow>
        {claiming.error && <Alert variant="destructive"><AlertDescription>{message(claiming.error, "Couldn't make you admin. Check the code.")}</AlertDescription></Alert>}
      </SettingsSection>
    )}
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
