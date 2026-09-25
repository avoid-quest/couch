import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { errorText, useSessionGate } from "@/session/session-context";

const remoteNameKey = "couch.remote-name";
function storedRemoteName() {
  try { return localStorage.getItem(remoteNameKey) || "My remote"; } catch { return "My remote"; }
}

export async function requestPairing(origin: string, code: string, name: string) {
  const response = await fetch(`${origin}/api/pair`, {
    method: "POST",
    signal: AbortSignal.timeout(8_000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name }),
  }).catch(() => { throw new Error("Couldn't reach Couch. Check you're on the same Wi-Fi."); });
  const result = await response.json() as { token?: string; installationId?: string; error?: string };
  if (!response.ok || !result.token || !result.installationId) throw new Error(response.status === 401 ? "Code expired. Enter the code shown on Couch now." : result.error || "Couldn't pair.");
  return { origin, token: result.token, installationId: result.installationId };
}

const slot = "h-12 min-w-0 w-auto flex-1 text-2xl";

// The shell remounts per connection, so a pairing that outlives its form never applies.
export function PairForm() {
  const { pairingOrigin, linkedPairingCode, savePairing, setError } = useSessionGate();
  const [pairingCode, setPairingCode] = useState(linkedPairingCode);
  const [remoteName, setRemoteName] = useState(storedRemoteName);
  const pairing = useMutation({ mutationFn: () => requestPairing(pairingOrigin, pairingCode.trim(), remoteName.trim()) });
  useEffect(() => { try { localStorage.setItem(remoteNameKey, remoteName); } catch { /* Pairing still works without remembering the name. */ } }, [remoteName]);
  const pair = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    pairing.mutate(undefined, { onSuccess: credentials => { setPairingCode(""); savePairing(credentials); } });
  };
  return (
    <form onSubmit={pair} className="pair-form grid max-w-md gap-6">
      <FieldGroup>
        <Field><FieldLabel htmlFor="remote-name">Remote name</FieldLabel><Input id="remote-name" autoFocus={!!pairingCode} autoComplete="off" maxLength={60} value={remoteName} onChange={event => setRemoteName(event.target.value)} required /></Field>
        <Field><FieldLabel htmlFor="pairing-code">Pairing code</FieldLabel>
          <InputOTP id="pairing-code" aria-label="Pairing code" maxLength={6} pattern={REGEXP_ONLY_DIGITS} autoFocus={!pairingCode} value={pairingCode} onChange={setPairingCode} pushPasswordManagerStrategy="none" containerClassName="w-full justify-start gap-2">
            <InputOTPGroup className="min-w-0 flex-1">{[0, 1, 2].map(index => <InputOTPSlot key={index} index={index} className={slot} />)}</InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup className="min-w-0 flex-1">{[3, 4, 5].map(index => <InputOTPSlot key={index} index={index} className={slot} />)}</InputOTPGroup>
          </InputOTP>
        </Field>
      </FieldGroup>
      {pairing.error && <Alert variant="destructive"><AlertDescription>{errorText(pairing.error)}</AlertDescription></Alert>}
      <Button className="justify-self-start" disabled={pairing.isPending || pairingCode.length !== 6 || !remoteName.trim()}>{pairing.isPending ? "Pairing…" : "Pair"}</Button>
    </form>
  );
}
