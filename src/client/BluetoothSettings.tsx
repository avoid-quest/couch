import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BluetoothAction, BluetoothState } from "../shared/bluetooth";
import type { SoundState } from "../shared/sound";

export function BluetoothSettings({ credentials: { origin, token }, connected }: { credentials: { origin: string; token: string }; connected: boolean }) {
  const [state, setState] = useState<BluetoothState | null>(null);
  const [sound, setSound] = useState<SoundState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState("");
  const operation = useRef<string | null>(null);
  const life = useRef<AbortController | null>(null);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  useEffect(() => {
    const controller = new AbortController(); life.current = controller;
    setState(null); setSound(null); setError(null); setPending(false);
    let reading = false;
    const read = async () => {
      if (reading || !connected) return;
      reading = true;
      try {
        const response = await fetch(`${origin}/api/bluetooth`, { headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7_000)]) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (!controller.signal.aborted) setState(result);
        const audio = await fetch(`${origin}/api/sound`, { headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]) });
        if (audio.ok) { const result = await audio.json(); if (!controller.signal.aborted) setSound(result); }
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Bluetooth did not answer."); }
      finally { reading = false; }
    };
    void read(); const timer = setInterval(read, 1_000);
    return () => {
      controller.abort(); clearInterval(timer);
      if (operation.current) void fetch(`${origin}/api/bluetooth`, { method: "POST", headers, keepalive: true, body: JSON.stringify({ action: { op: "cancel", token: operation.current } }) }).catch(() => {});
      operation.current = null;
    };
  }, [origin, token, connected]);
  useEffect(() => setAnswer(""), [state?.operation?.prompt?.id]);
  async function change(action: Omit<BluetoothAction, "owner">) {
    const controller = life.current;
    if (!controller || controller.signal.aborted) return;
    if (!["cancel", "answer"].includes(action.op)) { action.token = crypto.randomUUID(); operation.current = action.token; }
    setPending(true); setError(null);
    try {
      const response = await fetch(`${origin}/api/bluetooth`, { method: "POST", headers, body: JSON.stringify({ action }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7_000)]) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (!controller.signal.aborted) setState(result);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Bluetooth request failed."); }
    finally { if (!controller.signal.aborted) setPending(false); }
  }
  const active = state?.operation?.status === "running";
  const current = state?.operation;
  const own = current?.id === operation.current;
  const prompt = own ? current?.prompt : null;
  const disabled = !connected || pending || active;
  return <section className="space-y-4">
    <h3>Bluetooth audio</h3>
    <p>Put your speaker or headphones in pairing mode. Couch finds stereo audio devices for 30 seconds. Connecting does not select an output or resume playback.</p>
    {error && <p role="alert">{error}</p>}
    {!connected && <p>Reconnect to manage Bluetooth on the TV.</p>}
    {state?.adapter === "absent" && <p>No Bluetooth adapter is attached to the TV.</p>}
    {state?.adapter === "blocked" && <p>Bluetooth is blocked. Turn off airplane mode or release the TV computer's Bluetooth switch.</p>}
    {state?.adapter === "off" && <Button disabled={disabled} onClick={() => change({ op: "power" })}>Turn Bluetooth on</Button>}
    {state?.adapter === "available" && <Button disabled={disabled} onClick={() => change({ op: "scan" })}>Find audio devices</Button>}
    {current && <div role="status" className="space-y-2"><p>{active ? `${current.kind === "scan" ? "Finding audio devices" : "Bluetooth " + current.kind + " in progress"}${current.device ? " · " + current.device : ""}. This ends within one minute.` : current.message || "Bluetooth operation finished. Choose a connected output in Sound settings."}</p>{active && own && <Button disabled={!connected || pending} onClick={() => change({ op: "cancel", token: current.id })}>Cancel Bluetooth operation</Button>}{active && !own && <p>Another operation is running. Wait for it to finish.</p>}</div>}
    {prompt && <div className="space-y-2 rounded border p-3"><p>{prompt.kind === "confirm" ? `Confirm pairing${prompt.value ? " code " + prompt.value : " with this audio device"}?` : prompt.kind === "display" ? `Enter ${prompt.value} on the audio device.` : "Enter the pairing " + (prompt.kind === "pin" ? "PIN from the audio device's instructions." : "six-digit passkey.")}</p>{["pin", "passkey"].includes(prompt.kind) && <Input aria-label="Bluetooth pairing code" value={answer} maxLength={prompt.kind === "pin" ? 16 : 6} autoComplete="off" onChange={event => setAnswer(event.target.value)} />}{prompt.kind !== "display" && <Button disabled={!connected || pending || prompt.kind !== "confirm" && !answer} onClick={() => change({ op: "answer", token: current!.id, prompt: prompt.id, answer: prompt.kind === "confirm" ? "yes" : answer })}>{prompt.kind === "confirm" ? "Confirm pairing" : "Submit pairing code"}</Button>}</div>}
    {state?.devices.length === 0 && state.adapter === "available" && <p>No stereo audio devices found. Put the device in pairing mode and scan again.</p>}
    {state?.devices.map(device => {
      const outputs = sound?.outputs.filter(output => output.bluetoothAddress === device.address) ?? [];
      const selected = sound?.routing?.selectedBluetoothAddress === device.address || outputs.some(output => output.id === sound?.routing?.selectedOutput);
      return <div key={device.address} className="space-y-2 rounded border p-3"><p>{device.name}</p><p>{device.address} · {device.paired ? "Paired" : "Not paired"} · {device.connected ? "Connected" : "Disconnected"} · {selected ? "Selected in Sound" : "Not selected in Sound"}</p>{device.connected && <p>{outputs.length ? "Open Sound settings to select this output and test it." : "Waiting for the TV audio session to provide a stereo output."}</p>}<div className="flex flex-wrap gap-2">{!device.paired ? <Button disabled={disabled} onClick={() => change({ op: "pair", device: device.address })}>Pair {device.name}</Button> : <><Button disabled={disabled} onClick={() => change({ op: device.connected ? "disconnect" : "connect", device: device.address })}>{device.connected ? "Disconnect" : "Connect"} {device.name}</Button><Button variant="outline" disabled={disabled} onClick={() => change({ op: "forget", device: device.address })}>Forget {device.name}</Button></>}</div></div>;
    })}
    <p>The selected Bluetooth audio output gets one reconnect attempt when Couch starts. If a device disappears during playback, Sound keeps playback paused or stops live media until you reconnect and resume. Keyboard, controller and microphone pairing is not supported.</p>
  </section>;
}
