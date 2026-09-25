import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { REGEXP_ONLY_DIGITS } from "input-otp";
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
  });
  const result = await response.json() as { token?: string; installationId?: string; error?: string };
  if (!response.ok || !result.token || !result.installationId) throw new Error(response.status === 401 ? "That code is no longer valid. Scan the QR again or enter the code currently shown on the playback computer." : result.error || "Could not pair with the player.");
  return { origin, token: result.token, installationId: result.installationId };
}

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
    pairing.mutate(undefined, {
      onSuccess: credentials => { setPairingCode(""); savePairing(credentials); },
      onError: reason => setError(`${errorText(reason)} Check that your device and playback computer are on the same network, then try Connect again.`),
    });
  };
  return (
    <form onSubmit={pair} className="pair-form w-full max-w-md space-y-8">
      <FieldGroup>
        <Field><FieldLabel htmlFor="remote-name">Device name</FieldLabel><Input id="remote-name" className="rounded-none border-0 border-b border-border bg-transparent px-0 shadow-none focus-visible:ring-0" autoFocus={!!pairingCode} autoComplete="off" maxLength={60} value={remoteName} onChange={event => setRemoteName(event.target.value)} required /></Field>
        <Field><FieldLabel htmlFor="pairing-code">Pairing code</FieldLabel>
          <InputOTP id="pairing-code" aria-label="Pairing code" maxLength={6} pattern={REGEXP_ONLY_DIGITS} autoFocus={!pairingCode} value={pairingCode} onChange={setPairingCode} containerClassName="w-full justify-start gap-2">
            <InputOTPGroup className="min-w-0 flex-1"><InputOTPSlot index={0} className="h-14 min-w-0 w-auto flex-1 rounded-sm text-2xl" /><InputOTPSlot index={1} className="h-14 min-w-0 w-auto flex-1 rounded-sm text-2xl" /><InputOTPSlot index={2} className="h-14 min-w-0 w-auto flex-1 rounded-sm text-2xl" /></InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup className="min-w-0 flex-1"><InputOTPSlot index={3} className="h-14 min-w-0 w-auto flex-1 rounded-sm text-2xl" /><InputOTPSlot index={4} className="h-14 min-w-0 w-auto flex-1 rounded-sm text-2xl" /><InputOTPSlot index={5} className="h-14 min-w-0 w-auto flex-1 rounded-sm text-2xl" /></InputOTPGroup>
          </InputOTP>
        </Field>
      </FieldGroup>
      <Button disabled={pairing.isPending || pairingCode.length !== 6 || !remoteName.trim()}>{pairing.isPending ? "Connecting…" : "Connect"}</Button>
    </form>
  );
}
