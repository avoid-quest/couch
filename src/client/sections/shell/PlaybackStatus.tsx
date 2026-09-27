import type { ClientSessionState } from "@/session/session";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Field, FieldLabel } from "@/components/ui/field";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Credentials } from "@/session/session";
import type { Action } from "../../../shared/protocol";
import { forgetConnection, knownConnection } from "@/session/connection";
import { deviceName } from "@/copy";
import { useOptionalSessionGate } from "@/session/session-context";
import { StatusDot } from "./StatusLine";

function destinationOrigin(address: string): string | null {
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(address.trim()) ? address.trim() : `http://${address.trim()}`);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}

// Couch connection and pairing. Playback destinations live in Devices.
export function PlaybackStatus({ credentials, connected, status, installationName, localHost = false }: {
  credentials: Credentials | null;
  connected: boolean;
  status: string;
  installationName?: string;
  localHost?: boolean;
  state?: ClientSessionState | null;
  run?: (action: Action) => Promise<boolean>;
}) {
  const gate = useOptionalSessionGate();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [forgetting, setForgetting] = useState<{ origin: string; name: string } | null>(null);
  const [address, setAddress] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [addressError, setAddressError] = useState("");
  const name = deviceName(installationName);
  const origin = credentials?.origin ?? location.origin;
  const known = knownConnection();
  const other = known?.origin !== origin ? known : null;
  const label = `Connected to ${name}`;
  const choose = (value: string) => {
    const next = destinationOrigin(value);
    if (!next) { setAddressError("Enter just the address, like 192.168.1.10:4100."); return; }
    setAddressError("");
    if (next !== origin) setTarget(next);
  };
  return <><Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="ghost" className="min-w-0 shrink gap-2 touch:min-w-11" aria-label={`${label}: ${status}`}>
        <StatusDot connected={connected} />
        <span className="max-w-48 truncate max-sm:max-w-32">{label}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-96 gap-4" onCloseAutoFocus={event => { if (forgetting) event.preventDefault(); }}>
      <PopoverHeader><PopoverTitle>Couch connection</PopoverTitle><PopoverDescription role="status">{status}</PopoverDescription></PopoverHeader>
      {target ? <div className="grid gap-3">
        <p>Switch this browser to {new URL(target).host}?</p>
        <p className="text-muted-foreground">{name} keeps playing. You may need to pair.</p>
        <div className="flex flex-wrap gap-2"><Button onClick={() => location.assign(target)}>Switch</Button><Button variant="ghost" onClick={() => setTarget(null)}>Cancel</Button></div>
      </div> : <>
        <RadioGroup aria-label="Couch connection" value={origin} onValueChange={choose} className="gap-0">
          {[{ origin, name }, ...(other ? [{ origin: other.origin, name: other.details.name }] : [])].map((item, index) => <Field key={item.origin} orientation="horizontal" className="items-center py-1.5"><RadioGroupItem id={`play-on-${index}`} value={item.origin} aria-label={item.name} /><FieldLabel htmlFor={`play-on-${index}`} className="min-w-0 flex-1 cursor-pointer justify-between gap-2 font-normal"><span className="truncate">{item.name}</span><span className="truncate text-muted-foreground">{new URL(item.origin).host}</span></FieldLabel>{(item.origin !== origin || !localHost && credentials && gate) && <Button variant="ghost" size="sm" className="text-muted-foreground" aria-label={`Forget ${item.name}`} onClick={() => { setForgetting(item); setOpen(false); }}>Forget</Button>}</Field>)}
        </RadioGroup>
        <form onSubmit={event => { event.preventDefault(); choose(address); }}><InputGroup><InputGroupInput aria-label="Another Couch address" value={address} onChange={event => { setAddress(event.target.value); setAddressError(""); }} placeholder="Another Couch address" autoComplete="url" spellCheck={false} /><InputGroupAddon align="inline-end"><InputGroupButton type="submit" disabled={!address.trim()}>Connect</InputGroupButton></InputGroupAddon></InputGroup></form>
        {addressError && <Alert variant="destructive"><AlertDescription>{addressError}</AlertDescription></Alert>}
      </>}
    </PopoverContent>
  </Popover><AlertDialog open={forgetting !== null} onOpenChange={value => { if (!value) setForgetting(null); }}>
    <AlertDialogContent onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
      <AlertDialogHeader><AlertDialogTitle>Forget {forgetting?.name}?</AlertDialogTitle><AlertDialogDescription>That Couch keeps playing. You'll need to pair again to reconnect.</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (forgetting) { forgetConnection(forgetting.origin); if (forgetting.origin === origin) gate?.unpair(); } setForgetting(null); }}>Forget</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog></>;
}
