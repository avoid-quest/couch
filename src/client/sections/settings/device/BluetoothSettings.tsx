import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type ApiCredentials } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BluetoothAction, BluetoothState } from "../../../../shared/bluetooth";
import type { SoundState } from "../../../../shared/sound";
import { createId } from "../../../session/session";

type ListedBluetoothState = Omit<BluetoothState, "devices"> & { devices: (BluetoothState["devices"][number] & { available: boolean })[] };

function updateDevices(previous: ListedBluetoothState | null, next: BluetoothState, reset = false): ListedBluetoothState {
  // BlueZ inventory order changes on every read. Keep each result in its first-seen position.
  const devices = new Map((previous?.devices ?? []).filter(device => !reset || device.paired).map(device => [device.address, { ...device, available: false, connected: false }]));
  for (const device of next.devices) devices.set(device.address, { ...device, available: true });
  if (next.operation?.kind === "forget" && next.operation.status === "finished" && next.operation.device && (previous?.operation?.id !== next.operation.id || previous.operation.status !== "finished")) devices.delete(next.operation.device);
  return { ...next, devices: [...devices.values()] };
}

export function BluetoothSettings({ credentials, connected }: { credentials: ApiCredentials; connected: boolean }) {
  const queryClient = useQueryClient();
  const bluetoothKey = ["bluetooth", credentials.origin, credentials.token];
  const bluetooth = useQuery({
    queryKey: bluetoothKey,
    enabled: connected,
    queryFn: () => apiFetch(credentials, "/api/bluetooth").then(response => response.json() as Promise<BluetoothState>),
    refetchInterval: 1_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const sound = useQuery({
    queryKey: ["sound", credentials.origin, credentials.token],
    enabled: connected,
    queryFn: () => apiFetch(credentials, "/api/sound").then(response => response.json() as Promise<SoundState>),
    refetchInterval: 1_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const [state, setState] = useState<ListedBluetoothState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<{ address: string; op: "disconnect" | "forget" } | null>(null);
  const [answer, setAnswer] = useState("");
  const operation = useRef<string | null>(null);

  useEffect(() => {
    setState(null); setError(null); setPending(false); setConfirm(null); operation.current = null;
  }, [credentials.origin, credentials.token, connected]);
  useEffect(() => {
    if (!connected || !bluetooth.data) return;
    setState(previous => updateDevices(previous, bluetooth.data!));
  }, [connected, bluetooth.data, bluetooth.dataUpdatedAt]);
  useEffect(() => () => {
    if (operation.current) void apiFetch(credentials, "/api/bluetooth", {
      method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ action: { op: "cancel", token: operation.current } }),
    }).catch(() => {});
  }, [credentials]);
  useEffect(() => setAnswer(""), [state?.operation?.prompt?.id]);

  async function change(action: Omit<BluetoothAction, "owner">) {
    if (!connected || pending) return;
    setPending(true); setError(null);
    const send = (next: Omit<BluetoothAction, "owner">) => apiFetch(credentials, "/api/bluetooth", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: next }),
    }).then(response => response.json() as Promise<BluetoothState>);
    try {
      if (action.device && state?.operation?.kind === "scan" && state.operation.status === "running" && state.operation.id === operation.current) {
        await send({ op: "cancel", token: state.operation.id });
      }
      if (!["cancel", "answer"].includes(action.op)) { action.token = createId().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"); operation.current = action.token; }
      const result = await send(action);
      setState(previous => updateDevices(previous, result, action.op === "scan"));
      setConfirm(null);
      await queryClient.invalidateQueries({ queryKey: bluetoothKey });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Bluetooth request failed."); }
    finally { setPending(false); }
  }
  const active = state?.operation?.status === "running";
  const current = state?.operation;
  const own = current?.id === operation.current;
  const prompt = own ? current?.prompt : null;
  const searching = active && current?.kind === "scan";
  const disabled = !connected || pending || active;
  const deviceDisabled = !connected || state?.adapter !== "available" || pending || active && !(own && current?.kind === "scan");
  return <section className="space-y-4">
    <h3>Bluetooth</h3>
    <p>Put your device in pairing mode, then search and choose it below.</p>
    {(error || bluetooth.error?.message) && <p role="alert">{error || bluetooth.error?.message}</p>}
    {!connected && <p>Reconnect to manage Bluetooth on the playback computer.</p>}
    {state?.adapter === "absent" && <p>No Bluetooth adapter is attached to the playback computer.</p>}
    {state?.adapter === "blocked" && <p>Bluetooth is blocked. Turn off airplane mode or release the playback computer's Bluetooth switch.</p>}
    {state?.adapter === "off" && <Button disabled={disabled} onClick={() => change({ op: "power" })}>Turn Bluetooth on</Button>}
    {state?.adapter === "available" && <Button disabled={!connected || pending || active && !(own && searching)} onClick={() => change(own && searching ? { op: "cancel", token: current.id } : { op: "scan" })}>{searching ? own ? "Stop search" : "Searching…" : "Search"}</Button>}
    {current && <div role="status" className="space-y-2">
      <p className="min-h-10">{active ? !own ? "Another remote is managing Bluetooth. Wait for it to finish." : current.kind === "scan" ? "Searching for devices. Choose a result below." : current.message || "Connecting or updating your device…" : current.message || (current.kind === "scan" ? "Search finished. Choose a result below." : "Device updated.")}</p>
      {active && own && !searching && <Button disabled={!connected || pending} onClick={() => change({ op: "cancel", token: current.id })}>Cancel</Button>}
    </div>}
    {prompt && <div className="space-y-2 rounded border p-3"><p>{prompt.kind === "confirm" ? `Confirm pairing${prompt.value ? " code " + prompt.value : " with this device"}?` : prompt.kind === "display" ? `Enter ${prompt.value} on the device.` : "Enter the pairing " + (prompt.kind === "pin" ? "PIN from the device's instructions." : "six-digit passkey.")}</p>{["pin", "passkey"].includes(prompt.kind) && <Input aria-label="Bluetooth pairing code" value={answer} maxLength={prompt.kind === "pin" ? 16 : 6} autoComplete="off" onChange={event => setAnswer(event.target.value)} />}{prompt.kind !== "display" && <Button disabled={!connected || pending || prompt.kind !== "confirm" && !answer} onClick={() => change({ op: "answer", token: current!.id, prompt: prompt.id, answer: prompt.kind === "confirm" ? "yes" : answer })}>{prompt.kind === "confirm" ? "Confirm pairing" : "Submit pairing code"}</Button>}</div>}
    {state?.devices.length === 0 && state.adapter === "available" && <p>{active ? "No devices found yet." : "No devices found. Put your device in pairing mode and select Search."}</p>}
    <ul aria-label="Bluetooth devices" className="space-y-2">{state?.devices.map(device => {
      const outputs = sound.data?.outputs.filter(output => output.bluetoothAddress === device.address) ?? [];
      const selected = sound.data?.routing?.selectedBluetoothAddress === device.address || outputs.some(output => output.id === sound.data?.routing?.selectedOutput);
      return <li key={device.address} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3">
        <div className="min-w-0 break-words"><p>{device.name}</p><p className="text-sm text-muted-foreground"><span className="block min-h-10">{!device.available ? "Unavailable" : device.connected ? "Connected" : device.paired ? "Paired · Disconnected" : "Not paired"}{selected ? " · Selected for sound" : ""}</span><span className="block">{device.address}</span></p></div>
        <div className="flex flex-wrap gap-2"><Button disabled={deviceDisabled || !device.available} aria-label={`${device.connected ? "Disconnect" : "Connect"} ${device.name}`} onClick={() => device.connected ? setConfirm({ address: device.address, op: "disconnect" }) : change({ op: device.paired ? "connect" : "pair", device: device.address })}>{device.connected ? "Disconnect" : "Connect"}</Button>{device.paired && <Button variant="outline" disabled={deviceDisabled || !device.available} aria-label={`Forget ${device.name}`} onClick={() => setConfirm({ address: device.address, op: "forget" })}>Forget</Button>}</div>
        {confirm?.address === device.address && <div role="group" aria-label={`Confirm ${confirm.op} ${device.name}`} className="flex w-full flex-wrap items-center gap-2 border-t pt-3"><p className="mr-auto">{confirm.op === "forget" ? `Forget ${device.name} and remove its pairing?` : `Disconnect ${device.name} from sound?`}</p><Button variant="destructive" disabled={deviceDisabled} onClick={() => void change({ op: confirm.op, device: device.address })}>{confirm.op === "forget" ? "Forget device" : "Disconnect device"}</Button><Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>Cancel</Button></div>}
      </li>;
    })}</ul>
    <p className="text-sm text-muted-foreground">Search again to find unavailable devices. For speakers and headphones, check Sound for the connected output before playback. Connecting does not start playback.</p>
  </section>;
}
