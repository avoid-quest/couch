import { SettingsRowsSkeleton } from "@/components/LoadingMedia";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiSend, type ApiCredentials } from "@/api/client";
import { bluetoothQuery, bluetoothView, soundQuery, type ListedBluetoothState } from "@/api/settings";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { BluetoothAction, BluetoothState } from "../../../../shared/bluetooth";
import { createId } from "../../../session/session";

type Change = (action: Omit<BluetoothAction, "owner">) => void;

export function BluetoothSettings({ credentials, connected }: { credentials: ApiCredentials; connected: boolean }) {
  const queryClient = useQueryClient();
  const bluetooth = useQuery({ ...bluetoothQuery(credentials), enabled: connected });
  const sound = useQuery({ ...soundQuery(credentials), enabled: connected });
  const [confirm, setConfirm] = useState<{ address: string; name: string; op: "disconnect" | "forget" } | null>(null);
  const operation = useRef<string | null>(null);
  const state = connected ? bluetooth.data ?? null : null;
  const send = (action: Omit<BluetoothAction, "owner">) => apiSend<BluetoothState>(credentials, "/api/bluetooth", { action });
  const mutation = useMutation({
    mutationFn: async (action: Omit<BluetoothAction, "owner">) => {
      if (action.device && state?.operation?.kind === "scan" && state.operation.status === "running" && state.operation.id === operation.current) await send({ op: "cancel", token: state.operation.id });
      if (action.op !== "cancel") { action.token = createId().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"); operation.current = action.token; }
      return send(action);
    },
    onSuccess: (result, action) => queryClient.setQueryData<ListedBluetoothState>(bluetoothQuery(credentials).queryKey, previous => bluetoothView(previous, result, action.op === "scan")),
  });
  const pending = mutation.isPending;
  const error = mutation.error ? mutation.error.message || "Bluetooth didn't respond. Try again." : bluetooth.error?.message;
  useEffect(() => () => {
    if (operation.current) void apiFetch(credentials, "/api/bluetooth", {
      method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ action: { op: "cancel", token: operation.current } }),
    }).catch(() => {});
  }, [credentials]);

  const change: Change = action => { if (connected && !pending) mutation.mutate(action); };
  const current = state?.operation;
  const active = current?.status === "running";
  const own = current?.id === operation.current;
  const searching = active && current?.kind === "scan";
  const deviceDisabled = !connected || state?.adapter !== "available" || pending || active && !(own && searching);
  const status = !current ? null : active
    ? !own ? "Another device is using Bluetooth." : searching ? "Searching…" : current.message || "Connecting…"
    : current.message || (current.kind === "scan" ? "Search done." : "Device updated.");

  return <>
    <SettingsSection title="Bluetooth">
      {state?.adapter === "off" && <SettingsRow label="Bluetooth" description="Off">
        <Button disabled={!connected || pending || active} onClick={() => change({ op: "power" })}>Turn on</Button>
      </SettingsRow>}
      {state?.adapter === "available" && <SettingsRow label="Add a device" description="Put your device in pairing mode, then Search.">
        <Button variant="outline" disabled={!connected || pending || active && !(own && searching)} onClick={() => change(own && searching ? { op: "cancel", token: current.id } : { op: "scan" })}>{searching && own ? "Stop" : "Search"}</Button>
      </SettingsRow>}
      {state?.adapter === "absent" && <Alert><AlertDescription>No Bluetooth adapter found.</AlertDescription></Alert>}
      {state?.adapter === "blocked" && <Alert><AlertDescription>Bluetooth is blocked. Turn off airplane mode.</AlertDescription></Alert>}
      {!state && connected && !error && <SettingsRowsSkeleton />}
      {status && <div role="status" className="flex flex-wrap items-center gap-3 text-sm">
        {active && <Spinner />}<span className="text-muted-foreground">{status}</span>
        {active && own && !searching && <Button variant="outline" size="sm" disabled={!connected || pending} onClick={() => change({ op: "cancel", token: current.id })}>Cancel</Button>}
      </div>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription>{bluetooth.error && !mutation.error && <AlertAction><Button variant="outline" size="sm" disabled={!connected || pending} onClick={() => void bluetooth.refetch()}>Try again</Button></AlertAction>}</Alert>}
    </SettingsSection>
    {state?.adapter === "available" && <SettingsSection title="Bluetooth devices" description="After connecting a speaker, pick it as the Output above.">
      {state.devices.length === 0 && <Empty className="py-0"><EmptyHeader><EmptyDescription>{active ? "No devices found yet." : "No devices found. Put a device in pairing mode, then Search."}</EmptyDescription></EmptyHeader></Empty>}
      {state.devices.map(device => {
        const outputs = sound.data?.outputs.filter(output => output.bluetoothAddress === device.address) ?? [];
        const selected = sound.data?.routing?.selectedBluetoothAddress === device.address || outputs.some(output => output.id === sound.data?.routing?.selectedOutput);
        const label = [!device.available ? "Unavailable" : device.connected ? "Connected" : device.paired ? "Paired" : "Not paired", selected && "Sound output"].filter(Boolean).join(" · ");
        return <SettingsRow key={device.address} label={device.name} description={<>{label}<br />{device.address}</>}>
          <Button variant="outline" disabled={deviceDisabled || !device.available} aria-label={`${device.connected ? "Disconnect" : "Connect"} ${device.name}`} onClick={() => device.connected ? setConfirm({ address: device.address, name: device.name, op: "disconnect" }) : change({ op: device.paired ? "connect" : "pair", device: device.address })}>{device.connected ? "Disconnect" : "Connect"}</Button>
          {device.paired && <Button variant="ghost" disabled={deviceDisabled || !device.available} aria-label={`Forget ${device.name}`} onClick={() => setConfirm({ address: device.address, name: device.name, op: "forget" })}>Forget</Button>}
        </SettingsRow>;
      })}
    </SettingsSection>}
    <AlertDialog open={!!confirm} onOpenChange={open => { if (!open) setConfirm(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm?.op === "forget" ? `Forget ${confirm.name}?` : `Disconnect ${confirm?.name}?`}</AlertDialogTitle>
          <AlertDialogDescription>{confirm?.op === "forget" ? "You'll need to pair it again." : "You can connect it again later."}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => confirm && change({ op: confirm.op, device: confirm.address })}>{confirm?.op === "forget" ? "Forget" : "Disconnect"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
