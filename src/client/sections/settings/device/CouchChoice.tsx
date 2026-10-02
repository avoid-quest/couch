import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import type { Credentials } from "@/session/session";
import { connectionHash, forgetConnection, knownConnections } from "@/session/connection";
import { deviceNameHash } from "@/session/device-id";
import { isNativeHost } from "@/session/native-context";
import { useOptionalSessionGate } from "@/session/session-context";
import { deviceName } from "@/copy";
import { AppCouchChoice } from "@/sections/shell/PlaybackDevice";
import { AnotherCouchForm, ForgetCouchDialog } from "@/sections/shell/CouchForms";

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
      </SettingsRow> : <AnotherCouchForm description="Enter the address shown on that Couch." address={address} onAddressChange={value => { setAddress(value); setAddressError(""); }} onConnect={() => choose(address)} />}
      {addressError && <Alert variant="destructive"><AlertDescription>{addressError}</AlertDescription></Alert>}
    </SettingsSection>
    <ForgetCouchDialog name={forgetting?.name ?? null} onClose={() => setForgetting(null)} onForget={() => {
      if (forgetting) { forgetConnection(forgetting.origin); if (forgetting.origin === origin) gate?.unpair(); }
      return true;
    }} />
  </>;
}
