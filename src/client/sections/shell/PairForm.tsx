import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { errorText, useSessionGate } from "@/session/session-context";
import { deviceId, localDeviceName, useLocalDeviceName } from "@/session/device-id";
import { suggestedDeviceName } from "@/session/connection";
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

const slot = "h-14 min-w-0 w-auto flex-1 text-2xl font-medium tabular-nums";

// The shell remounts per connection, so a pairing that outlives its form never applies.
export function PairForm() {
  const { pairingOrigin, linkedPairingCode, savePairing, setError, details } = useSessionGate();
  const [pairingCode, setPairingCode] = useState(linkedPairingCode);
  const savedName = useLocalDeviceName();
  // Asked once: the first connection keeps the name, and every later pairing reuses it. A browser
  // that switched here from another Couch brings its name there, shown to keep or change.
  const [name, setName] = useState(suggestedDeviceName ?? "");
  const pairing = useMutation({ mutationFn: () => requestPairing(pairingOrigin, pairingCode.trim(), name.trim(), details?.name) });
  const pair = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    pairing.mutate(undefined, { onSuccess: credentials => { setPairingCode(""); savePairing(credentials); } });
  };
  return (
    <form onSubmit={pair} className="pair-form grid max-w-md gap-6">
      <FieldGroup className="gap-6">
        {!savedName && <Field><FieldLabel htmlFor="device-name">Name this device</FieldLabel><Input id="device-name" className="h-11" aria-describedby="device-name-hint" autoFocus={!!pairingCode} autoComplete="off" maxLength={60} placeholder={defaultDeviceName(deviceId())} value={name} onChange={event => setName(event.target.value)} /><FieldDescription id="device-name-hint">A name you'll recognize when choosing where to play.</FieldDescription></Field>}
        <Field><FieldLabel htmlFor="pairing-code">Pairing code</FieldLabel>
          <InputOTP id="pairing-code" aria-label="Pairing code" aria-invalid={!!pairing.error} aria-describedby={pairing.error ? "pairing-error" : undefined} disabled={pairing.isPending} maxLength={6} pattern={REGEXP_ONLY_DIGITS} autoFocus={!!savedName || !pairingCode} value={pairingCode} onChange={code => { setPairingCode(code); if (pairing.error) pairing.reset(); }} pushPasswordManagerStrategy="none" containerClassName="w-full justify-start gap-2">
            <InputOTPGroup className="min-w-0 flex-1">{[0, 1, 2].map(index => <InputOTPSlot key={index} index={index} className={slot} />)}</InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup className="min-w-0 flex-1">{[3, 4, 5].map(index => <InputOTPSlot key={index} index={index} className={slot} />)}</InputOTPGroup>
          </InputOTP>
        </Field>
      </FieldGroup>
      {pairing.error && <Alert id="pairing-error" variant="destructive"><AlertDescription>{errorText(pairing.error)}</AlertDescription></Alert>}
      <Button size="lg" className="w-full" disabled={pairing.isPending || pairingCode.length !== 6}>{pairing.isPending ? "Pairing…" : "Pair"}</Button>
    </form>
  );
}
