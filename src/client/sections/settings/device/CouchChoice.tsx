import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import type { Credentials } from "@/session/session";
import { connectionHash, forgetConnection, knownConnections } from "@/session/connection";
import { deviceNameHash } from "@/session/device-id";
import { isNativeHost } from "@/session/native-context";
import { useOptionalSessionGate } from "@/session/session-context";
import { deviceName } from "@/copy";
import { AppCouchChoice } from "@/sections/shell/PlaybackDevice";

type Props = { credentials: Credentials | null; installationName?: string };

/** One server choice shared by the header and Settings. */
export function CouchChoice(props: Props) {
  return isNativeHost() ? <AppCouchChoice installationName={props.installationName} /> : <BrowserCouchChoice {...props} />;
}

function destinationOrigin(address: string): string | null {
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(address.trim()) ? address.trim() : `http://${address.trim()}`);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}

/** A browser shows the Couch at its address; another Couch is another address. */
function BrowserCouchChoice({ credentials, installationName }: Props) {
  const gate = useOptionalSessionGate();
  const [forgetting, setForgetting] = useState<{ origin: string; name: string } | null>(null);
  const [address, setAddress] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [addressError, setAddressError] = useState("");
  const name = deviceName(installationName);
  const origin = credentials?.origin ?? location.origin;
  const others = knownConnections().filter(item => item.origin !== origin);
  const choose = (value: string) => {
    const next = destinationOrigin(value);
    if (!next) { setAddressError("Enter just the address, like 192.168.1.10:4100."); return; }
    setAddressError("");
    if (next !== origin) setTarget(next);
  };
  return <>
    <SettingsSection title="Couch" description="The Couch this browser shows.">
      {[{ origin, name }, ...others].map(item => <SettingsRow key={item.origin} label={item.name} description={new URL(item.origin).host}>
        {item.origin === origin ? <span className="text-sm text-muted-foreground">In use</span> : <Button variant="outline" onClick={() => choose(item.origin)}>Switch</Button>}
        {(item.origin !== origin || credentials && gate) && <Button variant="ghost" aria-label={`Forget ${item.name}`} onClick={() => setForgetting(item)}>Forget</Button>}
      </SettingsRow>)}
      {target ? <SettingsRow label={`Switch this browser to ${new URL(target).host}?`} description={`${name} keeps playing. You may need to pair.`}>
        <Button onClick={() => location.assign(target + connectionHash(deviceNameHash(), { origin, name }, target))}>Switch</Button><Button variant="ghost" onClick={() => setTarget(null)}>Cancel</Button>
      </SettingsRow> : <SettingsRow label="Another Couch" htmlFor="another-couch-address" description="Enter the address shown on that Couch.">
        <form className="flex w-full flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); choose(address); }}>
          <Input id="another-couch-address" className="min-w-0 flex-1" value={address} onChange={event => { setAddress(event.target.value); setAddressError(""); }} placeholder="192.168.1.10:4100" autoComplete="url" spellCheck={false} />
          <Button type="submit" variant="outline" disabled={!address.trim()}>Connect</Button>
        </form>
      </SettingsRow>}
      {addressError && <Alert variant="destructive"><AlertDescription>{addressError}</AlertDescription></Alert>}
    </SettingsSection>
    <AlertDialog open={forgetting !== null} onOpenChange={value => { if (!value) setForgetting(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Forget {forgetting?.name}?</AlertDialogTitle><AlertDialogDescription>That Couch keeps playing. You'll need to pair again to reconnect.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (forgetting) { forgetConnection(forgetting.origin); if (forgetting.origin === origin) gate?.unpair(); } setForgetting(null); }}>Forget</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
