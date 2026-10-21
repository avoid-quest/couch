import { SettingsRowsSkeleton } from "@/components/LoadingMedia";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
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
import { formatSeen } from "@/time-format";
import { Laptop, MonitorSmartphone, Smartphone, Tv } from "lucide-react";
import { staleDuplicates, type Device, type DeviceIdentity } from "../../../../shared/devices";
import { cn } from "@/lib/utils";
import { RenameCouch } from "./RenameCouch";

/** A device's name after its glyph where its kind is known: a TV, the computer that runs Couch, this device; others are a phone or computer. */
function DeviceName({ kind, online, children }: { kind: "tv" | "computer" | "phone" | null; online: boolean; children: ReactNode }) {
  const Icon = kind === "tv" ? Tv : kind === "computer" ? Laptop : kind === "phone" ? Smartphone : MonitorSmartphone;
  return <span className="flex min-w-0 items-center gap-2"><Icon aria-hidden="true" className={cn("size-4 shrink-0", !online && "text-muted-foreground")} /><span className="min-w-0 break-words">{children}</span></span>;
}

export function DevicesSettings({ credentials, connected, urls, identity, remoteControlEnabled, administratorClaimed, hostName = "Couch", online = new Set(), tvs = new Set(), hostTv = false }: {
  credentials: ApiCredentials; connected: boolean; urls: string[]; identity: DeviceIdentity;
  remoteControlEnabled: boolean; administratorClaimed: boolean; hostName?: string;
  /** Devices connected now, from the session state. */
  online?: ReadonlySet<string>;
  /** Devices known to be TVs, and whether the host is one. */
  tvs?: ReadonlySet<string>; hostTv?: boolean;
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
  const [removing, setRemoving] = useState<Device[]>([]);
  const pairingRef = useRef<HTMLButtonElement>(null);
  const pairUrl = urls[0];
  const refreshDevices = () => queryClient.invalidateQueries({ queryKey: devicesQuery(credentials).queryKey });
  const claiming = useMutation({ mutationFn: (value: string) => apiSend(credentials, "/api/devices/claim", { code: value }), onSuccess: refreshDevices });
  const deviceChange = useMutation({
    mutationFn: async ({ targets, action }: { targets: Device[]; action: "role" | "remove" }) => {
      for (const target of targets) await (action === "role"
        ? apiSend(credentials, `/api/devices/${target.id}/role`, { role: target.role === "administrator" ? "controller" : "administrator" })
        : apiSend(credentials, `/api/devices/${target.id}`, undefined, "DELETE"));
    },
    onSettled: refreshDevices,
  });
  const message = (error: Error | null, fallback: string) => error ? error.message || fallback : null;
  const pending = deviceChange.isPending;
  const act = (targets: Device[], action: "role" | "remove") => { if (!pending && targets.length) deviceChange.mutate({ targets, action }); };
  const isOnline = (device: Device) => online.has(device.id);
  const stale = staleDuplicates(devices.data ?? [], online, selfId);
  const kind = (device: Device) => tvs.has(device.id) || device.role === "host" && hostTv ? "tv" as const
    : device.role === "host" ? "computer" as const
    : device.id === selfId ? matchMedia("(pointer: coarse)").matches ? "phone" as const : "computer" as const : null;
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
      {devices.isSuccess && !host && manager && !devices.data.some(device => device.role === "host") && <SettingsRow label={<DeviceName kind={hostTv ? "tv" : "computer"} online>{hostName}</DeviceName>} description="Runs this Couch">
        <RenameCouch credentials={credentials} connected={connected} name={hostName} onRenamed={refreshDevices} />
      </SettingsRow>}
      {devices.isPending ? <SettingsRowsSkeleton />
        : devices.isError ? <Alert variant="destructive"><AlertDescription>Couldn't load devices.</AlertDescription><AlertAction><Button variant="outline" size="sm" onClick={() => void devices.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>
        : !devices.data.length ? <Empty className="py-0"><EmptyHeader><EmptyDescription>No devices yet. Use Pair a device to connect one.</EmptyDescription></EmptyHeader></Empty>
        : <>
          {devices.data.map(device => (
            <SettingsRow key={device.id} data-device={device.id} data-stale={stale.includes(device) || undefined}
              label={<DeviceName kind={kind(device)} online={device.role === "host" || isOnline(device)}>{device.name}{device.id === selfId && <span className="text-muted-foreground"> (this device)</span>}</DeviceName>}
              description={device.role === "host" ? "Runs this Couch" : [device.role === "administrator" && "Admin", isOnline(device) ? "Online" : device.lastSeenAt ? `Seen ${formatSeen(device.lastSeenAt)}` : "Never seen", stale.includes(device) && "Older duplicate"].filter(Boolean).join(" · ")}>
              {!host && manager && device.role === "host" && <RenameCouch credentials={credentials} connected={connected} name={device.name} onRenamed={refreshDevices} />}
              {manager && device.role !== "host" && device.id !== selfId && <>
                {/* A left-behind duplicate offers only Forget. */}
                {!stale.includes(device) && <Button variant="outline" disabled={pending} onClick={() => act([device], "role")}>{device.role === "administrator" ? "Remove admin" : "Make admin"}</Button>}
                <Button variant={stale.includes(device) ? "outline" : "ghost"} disabled={pending} onClick={() => setRemoving([device])}>Forget</Button>
              </>}
            </SettingsRow>
          ))}
          {manager && stale.length > 1 && <SettingsRow label="Older duplicates" description={`${stale.length} offline devices share a name with a newer one.`}>
            <Button variant="outline" disabled={pending} onClick={() => setRemoving(stale)}>Forget all</Button>
          </SettingsRow>}
        </>}
      {deviceChange.error && <Alert variant="destructive"><AlertDescription>{message(deviceChange.error, "Couldn't update the device. Try again.")}</AlertDescription></Alert>}
    </SettingsSection>
    {host && remoteControlEnabled && !administratorClaimed && paired && (
      <SettingsSection title="Make a device the admin" description="Enter this one-time code on a paired device." data-administrator-setup>
        <div className="flex min-w-0 flex-col gap-1">
          {setupCode.isPending ? <SettingsRowsSkeleton />
            : setupCode.isError || !setupCode.data || !pairUrl ? <Alert variant="destructive"><AlertDescription>Couldn't load the admin code.</AlertDescription><AlertAction><Button variant="outline" size="sm" disabled={!connected || setupCode.isFetching} onClick={() => void setupCode.refetch()}>Try again</Button></AlertAction></Alert>
            : <><p className="font-mono text-3xl tracking-wider" data-administrator-code>{setupCode.data.code}</p><a data-text-link className="break-all text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" href={pairUrl}>{pairUrl}</a></>}
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
    <AlertDialog open={removing.length > 0} onOpenChange={open => { if (!open) setRemoving([]); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{removing.length > 1 ? `Forget ${removing.length} older duplicates?` : `Forget ${removing[0]?.name}?`}</AlertDialogTitle>
          <AlertDialogDescription>{removing.length > 1 ? "They will need to pair again." : "It will need to pair again."}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => act(removing, "remove")}>Forget</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
