import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AudioLines, Bluetooth, MonitorSmartphone, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SoundState } from "../shared/sound";
import type { BluetoothState } from "../shared/bluetooth";
import type { Credentials } from "./session";

// Quick check of where playback runs and where its sound comes out.
// Wi-Fi signal lives in the OS, not here; the LAN address and the audio route are what Couch knows.
export function PlaybackStatus({ credentials, connected, status, installationName }: {
  credentials: Credentials | null;
  connected: boolean;
  status: string;
  installationName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [sound, setSound] = useState<SoundState | null>(null);
  const [bluetooth, setBluetooth] = useState<BluetoothState | null>(null);
  const [soundFailed, setSoundFailed] = useState(false);
  const [bluetoothFailed, setBluetoothFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [outputError, setOutputError] = useState("");

  useEffect(() => {
    if (!open || !credentials || !connected) return;
    const controller = new AbortController();
    const headers = { Authorization: `Bearer ${credentials.token}` };
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]);
    setLoading(true);
    void Promise.allSettled([
      fetch(`${credentials.origin}/api/sound`, { headers, signal }).then(response => response.ok ? response.json() : Promise.reject(new Error("Sound is unavailable."))),
      fetch(`${credentials.origin}/api/bluetooth`, { headers, signal }).then(response => response.ok ? response.json() : Promise.reject(new Error("Bluetooth is unavailable."))),
    ]).then(([soundResult, bluetoothResult]) => {
      if (controller.signal.aborted) return;
      setSound(soundResult.status === "fulfilled" ? soundResult.value : null);
      setBluetooth(bluetoothResult.status === "fulfilled" ? bluetoothResult.value : null);
      setSoundFailed(soundResult.status === "rejected");
      setBluetoothFailed(bluetoothResult.status === "rejected");
      setLoading(false);
    });
    return () => controller.abort();
  }, [open, credentials, connected]);

  const outputs = sound?.outputs.filter(output => output.availability !== "unavailable" && !output.testBlocked) ?? [];
  const selected = sound?.routing?.selectedOutput ?? sound?.defaultOutput ?? null;
  const observed = sound?.outputs.find(output => output.id === sound.routing?.observedOutput);
  const connectedDevices = bluetooth?.devices.filter(device => device.connected) ?? [];
  const adapterReady = bluetooth?.adapter === "available";

  const selectOutput = async (output: string) => {
    if (!credentials) return;
    const controller = new AbortController();
    setPending(true); setOutputError("");
    try {
      const response = await fetch(`${credentials.origin}/api/sound/output`, {
        method: "POST",
        headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ output }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not change the sound output.");
      setSound(result as SoundState);
    } catch (reason) { setOutputError(reason instanceof Error ? reason.message : "Could not change the sound output."); }
    finally { setPending(false); }
  };

  const name = installationName || "Couch";
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="ghost" className="playback-status" aria-label={`Playback on ${name}: ${status}`}>
        <span className={`connection-dot ${connected ? "online" : ""}`} aria-hidden="true" />
        <span className="playback-status-name">{name}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-80 gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <p className="font-medium">Playback on {name}</p>
          <p className="text-muted-foreground" role="status">{status}</p>
        </div>
        <MonitorSmartphone className="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      {credentials?.origin && <p className="flex items-center gap-2 text-muted-foreground"><span className="sr-only">Connection</span><AudioLines className="size-4" aria-hidden="true" />{new URL(credentials.origin).host}</p>}
      <div className="grid gap-2">
        <p className="text-sm font-medium">Sound output</p>
        {outputs.length
          ? <Select value={selected ?? undefined} onValueChange={output => void selectOutput(output)} disabled={pending || !connected}>
            <SelectTrigger className="w-full" aria-label="Sound output"><SelectValue placeholder="Choose output" /></SelectTrigger>
            <SelectContent>{outputs.map(output => <SelectItem key={output.id} value={output.id}>{output.name || output.id}</SelectItem>)}</SelectContent>
          </Select>
        : <p className="text-muted-foreground">{!connected ? "Connect to choose an output." : soundFailed ? "Sound needs a connected player." : loading ? "Checking outputs…" : "No outputs reported."}</p>}
        {observed && observed.id !== selected && <p className="text-xs text-muted-foreground">Now playing on {observed.name || observed.id}.</p>}
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Bluetooth</p>
        {!adapterReady && <p className="text-muted-foreground">{!connected ? "Connect to see Bluetooth devices." : bluetoothFailed ? "Bluetooth needs a connected player." : bluetooth ? bluetooth.adapter === "off" ? "Bluetooth is off on the playback computer." : "Bluetooth is unavailable." : "Checking Bluetooth…"}</p>}
        {adapterReady && !!connectedDevices.length && <ul className="grid gap-1">{connectedDevices.map(device => <li key={device.address} className="flex items-center gap-2 text-muted-foreground"><Bluetooth className="size-4" aria-hidden="true" />{device.name}</li>)}</ul>}
        {adapterReady && !connectedDevices.length && <p className="text-muted-foreground">No devices connected. Pair speakers in settings.</p>}
      </div>
      {outputError && <p role="alert" className="text-sm text-destructive">{outputError}</p>}
      <Button variant="outline" className="w-full" asChild><Link to="/settings/sound" onClick={() => setOpen(false)}><Settings2 aria-hidden="true" />Sound settings</Link></Button>
    </PopoverContent>
  </Popover>;
}
