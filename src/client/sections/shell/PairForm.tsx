import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { errorText, useSessionGate } from "@/session/session-context";
import { deviceId, localDeviceName, useLocalDeviceName } from "@/session/device-id";
import { deviceName } from "@/copy";
import { defaultDeviceName } from "../../../shared/devices";

export async function requestPairing(origin: string, code: string, name: string, hostName?: string) {
  const id = deviceId();
  const response = await fetch(`${origin}/api/pair`, {
    method: "POST",
    signal: AbortSignal.timeout(8_000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, id, name: localDeviceName() ?? (name || defaultDeviceName(id)) }),
  }).catch(() => { throw new Error("Couldn't reach Couch. Check you're on the same Wi-Fi."); });
  const result = await response.json() as { token?: string; installationId?: string; error?: string };
  if (!response.ok || !result.token || !result.installationId) throw new Error(response.status === 401 ? `That code didn't work. Enter the code shown on ${deviceName(hostName)}.` : result.error || "Couldn't pair.");
  return { origin, token: result.token, installationId: result.installationId };
}

const slot = "h-8 touch:h-11 min-w-0 w-auto flex-1 text-sm";

// The shell remounts per connection, so a pairing that outlives its form never applies.
export function PairForm() {
  const { pairingOrigin, linkedPairingCode, savePairing, setError, details } = useSessionGate();
  const [pairingCode, setPairingCode] = useState(linkedPairingCode);
  const savedName = useLocalDeviceName();
  // Asked once: the first connection keeps the name, and every later pairing reuses it.
  const [name, setName] = useState("");
  const pairing = useMutation({ mutationFn: () => requestPairing(pairingOrigin, pairingCode.trim(), name.trim(), details?.name) });
  const pair = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    pairing.mutate(undefined, { onSuccess: credentials => { setPairingCode(""); savePairing(credentials); } });
  };
  return (
    <form onSubmit={pair} className="pair-form grid max-w-md gap-6">
      <FieldGroup>
        {!savedName && <Field><FieldLabel htmlFor="device-name">Name this device</FieldLabel><Input id="device-name" autoFocus={!!pairingCode} autoComplete="off" maxLength={60} placeholder={defaultDeviceName(deviceId())} value={name} onChange={event => setName(event.target.value)} /></Field>}
        <Field><FieldLabel htmlFor="pairing-code">Pairing code</FieldLabel>
          <InputOTP id="pairing-code" aria-label="Pairing code" maxLength={6} pattern={REGEXP_ONLY_DIGITS} autoFocus={!!savedName || !pairingCode} value={pairingCode} onChange={setPairingCode} pushPasswordManagerStrategy="none" containerClassName="w-full justify-start gap-2">
            <InputOTPGroup className="min-w-0 flex-1">{[0, 1, 2].map(index => <InputOTPSlot key={index} index={index} className={slot} />)}</InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup className="min-w-0 flex-1">{[3, 4, 5].map(index => <InputOTPSlot key={index} index={index} className={slot} />)}</InputOTPGroup>
          </InputOTP>
        </Field>
      </FieldGroup>
      {pairing.error && <Alert variant="destructive"><AlertDescription>{errorText(pairing.error)}</AlertDescription></Alert>}
      <Button className="justify-self-start" disabled={pairing.isPending || pairingCode.length !== 6}>{pairing.isPending ? "Pairing…" : "Pair"}</Button>
    </form>
  );
}
