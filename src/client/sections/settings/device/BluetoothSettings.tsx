import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiSend, type ApiCredentials } from "@/api/client";
import { bluetoothQuery, bluetoothView, soundQuery, type ListedBluetoothState } from "@/api/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BluetoothAction, BluetoothState } from "../../../../shared/bluetooth";
import { createId } from "../../../session/session";

export function BluetoothSettings({ credentials, connected }: { credentials: ApiCredentials; connected: boolean }) {
  const queryClient = useQueryClient();
  const bluetooth = useQuery({ ...bluetoothQuery(credentials), enabled: connected });
  const sound = useQuery({ ...soundQuery(credentials), enabled: connected });
  const [confirm, setConfirm] = useState<{ address: string; op: "disconnect" | "forget" } | null>(null);
  const [answer, setAnswer] = useState("");
  const operation = useRef<string | null>(null);
  const state = connected ? bluetooth.data ?? null : null;
  const send = (action: Omit<BluetoothAction, "owner">) => apiSend<BluetoothState>(credentials, "/api/bluetooth", { action });
  const mutation = useMutation({
    mutationFn: async (action: Omit<BluetoothAction, "owner">) => {
      if (action.device && state?.operation?.kind === "scan" && state.operation.status === "running" && state.operation.id === operation.current) await send({ op: "cancel", token: state.operation.id });
      if (!["cancel", "answer"].includes(action.op)) { action.token = createId().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"); operation.current = action.token; }
      return send(action);
    },
    onSuccess: (result, action) => {
      queryClient.setQueryData<ListedBluetoothState>(bluetoothQuery(credentials).queryKey, previous => bluetoothView(previous, result, action.op === "scan"));
      setConfirm(null);
    },
  });
  const pending = mutation.isPending;
  const error = mutation.error ? mutation.error instanceof Error ? mutation.error.message : "Bluetooth request failed." : null;
  useEffect(() => () => {
    if (operation.current) void apiFetch(credentials, "/api/bluetooth", {
      method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ action: { op: "cancel", token: operation.current } }),
    }).catch(() => {});
  }, [credentials]);
  useEffect(() => setAnswer(""), [state?.operation?.prompt?.id]);

  function change(action: Omit<BluetoothAction, "owner">) {
    if (connected && !pending) mutation.mutate(action);
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
    {prompt && <div className="space-y-2 border-t border-border py-3"><p>{prompt.kind === "confirm" ? `Confirm pairing${prompt.value ? " code " + prompt.value : " with this device"}?` : prompt.kind === "display" ? `Enter ${prompt.value} on the device.` : "Enter the pairing " + (prompt.kind === "pin" ? "PIN from the device's instructions." : "six-digit passkey.")}</p>{["pin", "passkey"].includes(prompt.kind) && <Input aria-label="Bluetooth pairing code" value={answer} maxLength={prompt.kind === "pin" ? 16 : 6} autoComplete="off" onChange={event => setAnswer(event.target.value)} />}{prompt.kind !== "display" && <Button disabled={!connected || pending || prompt.kind !== "confirm" && !answer} onClick={() => change({ op: "answer", token: current!.id, prompt: prompt.id, answer: prompt.kind === "confirm" ? "yes" : answer })}>{prompt.kind === "confirm" ? "Confirm pairing" : "Submit pairing code"}</Button>}</div>}
    {state?.devices.length === 0 && state.adapter === "available" && <p>{active ? "No devices found yet." : "No devices found. Put your device in pairing mode and select Search."}</p>}
    <ul aria-label="Bluetooth devices" className="divide-y border-t border-border">{state?.devices.map(device => {
      const outputs = sound.data?.outputs.filter(output => output.bluetoothAddress === device.address) ?? [];
      const selected = sound.data?.routing?.selectedBluetoothAddress === device.address || outputs.some(output => output.id === sound.data?.routing?.selectedOutput);
      return <li key={device.address} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0 break-words"><p>{device.name}</p><p className="text-sm text-muted-foreground"><span className="block min-h-10">{!device.available ? "Unavailable" : device.connected ? "Connected" : device.paired ? "Paired · Disconnected" : "Not paired"}{selected ? " · Selected for sound" : ""}</span><span className="block">{device.address}</span></p></div>
        <div className="flex flex-wrap gap-2"><Button disabled={deviceDisabled || !device.available} aria-label={`${device.connected ? "Disconnect" : "Connect"} ${device.name}`} onClick={() => device.connected ? setConfirm({ address: device.address, op: "disconnect" }) : change({ op: device.paired ? "connect" : "pair", device: device.address })}>{device.connected ? "Disconnect" : "Connect"}</Button>{device.paired && <Button variant="outline" disabled={deviceDisabled || !device.available} aria-label={`Forget ${device.name}`} onClick={() => setConfirm({ address: device.address, op: "forget" })}>Forget</Button>}</div>
        {confirm?.address === device.address && <div role="group" aria-label={`Confirm ${confirm.op} ${device.name}`} className="flex w-full flex-wrap items-center gap-2 border-t pt-3"><p className="mr-auto">{confirm.op === "forget" ? `Forget ${device.name} and remove its pairing?` : `Disconnect ${device.name} from sound?`}</p><Button variant="destructive" disabled={deviceDisabled} onClick={() => change({ op: confirm.op, device: device.address })}>{confirm.op === "forget" ? "Forget device" : "Disconnect device"}</Button><Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>Cancel</Button></div>}
      </li>;
    })}</ul>
    <p className="text-sm text-muted-foreground">Search again to find unavailable devices. For speakers and headphones, check Sound for the connected output before playback. Connecting does not start playback.</p>
  </section>;
}
