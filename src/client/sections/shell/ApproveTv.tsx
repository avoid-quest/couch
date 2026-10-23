import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { ApiError, apiJson, apiSend } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Spinner } from "@/components/ui/spinner";
import { useSessionGate } from "@/session/session-context";
import { notice } from "@/toasts";
import type { Device } from "../../../shared/devices";
import { useShell } from "./shell-context";
import { Onboarding } from "./Onboarding";
import { groupedCode } from "./TvPairing";

const slot = "h-14 min-w-0 w-auto flex-1 text-2xl font-medium tabular-nums";

/** /pair/tv: a paired admin confirms the TV whose code they scanned or typed (TvPairing). */
export function ApproveTv() {
  const { credentials } = useShell();
  const { identity } = useSessionGate();
  const navigate = useNavigate();
  // Read raw: the router would turn the digits into a number.
  const [code, setCode] = useState(() => /^\d{6}$/.exec(new URLSearchParams(location.search).get("code") ?? "")?.[0] ?? "");
  const ready = !!identity && identity.authority !== "controller" && code.length === 6;
  const request = useQuery({ queryKey: ["tv-pairing", code], queryFn: ({ signal }) => apiJson<{ name: string }>(credentials, `/api/pair/tv/${code}`, { signal }), enabled: ready, retry: false, staleTime: Infinity });
  const leave = () => void navigate({ to: "/", replace: true });
  const pair = useMutation({ mutationFn: () => apiSend<{ device: Device }>(credentials, `/api/pair/tv/${code}`), onSuccess: ({ device }) => { notice(`${device.name} paired`); leave(); } });
  const name = request.data?.name;
  const error = pair.error ?? (request.isError ? request.error : null);
  if (identity?.authority === "controller" || (error instanceof ApiError && error.status === 403)) return <Onboarding embedded title="Pair a TV" description="Only an admin can pair a TV. Ask one to scan the code it shows."><Button variant="outline" className="justify-self-start" onClick={leave}>Cancel</Button></Onboarding>;
  if (name && !request.isError) return <Onboarding embedded title={`Pair ${name}?`} description={<>Check that the TV shows <span className="text-foreground tabular-nums">{groupedCode(code)}</span>.</>}>
    {pair.error && <Alert variant="destructive"><AlertDescription>{pair.error.message}</AlertDescription></Alert>}
    <div className="grid grid-cols-2 gap-3 sm:flex">
      <Button size="lg" data-page-first disabled={pair.isPending} onClick={() => pair.mutate()}>{pair.isPending ? "Pairing…" : "Pair"}</Button>
      <Button size="lg" variant="outline" disabled={pair.isPending} onClick={leave}>Cancel</Button>
    </div>
  </Onboarding>;
  return <Onboarding embedded title="Pair a TV" description="Enter the code your TV shows.">
    {!request.isFetching && <InputOTP aria-label="TV code" aria-invalid={!!error} aria-describedby={error ? "tv-code-error" : undefined} maxLength={6} pattern={REGEXP_ONLY_DIGITS} autoFocus value={code} onChange={setCode} pushPasswordManagerStrategy="none" containerClassName="w-full justify-start gap-2">
      <InputOTPGroup className="min-w-0 flex-1">{[0, 1, 2].map(index => <InputOTPSlot key={index} index={index} className={slot} />)}</InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup className="min-w-0 flex-1">{[3, 4, 5].map(index => <InputOTPSlot key={index} index={index} className={slot} />)}</InputOTPGroup>
    </InputOTP>}
    {request.isFetching && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner role="presentation" aria-hidden="true" aria-label={undefined} />Finding the TV…</p>}
    {error && <Alert id="tv-code-error" variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
    <Button variant="outline" className="justify-self-start" onClick={leave}>Cancel</Button>
  </Onboarding>;
}
