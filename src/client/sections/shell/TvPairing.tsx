import { useEffect, useId, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { ApiError } from "@/api/client";
import { CouchMark } from "@/components/CouchMark";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TRY_AGAIN } from "@/copy";
import { useSessionGate } from "@/session/session-context";
import { deviceId, localDeviceName } from "@/session/device-id";
import { defaultDeviceName } from "../../../shared/devices";

async function pairingPost<T>(origin: string, path: string, body: unknown) {
  const response = await fetch(`${origin}${path}`, { method: "POST", signal: AbortSignal.timeout(8_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .catch(() => { throw new Error("Couldn't reach Couch. Check the TV is on the same Wi-Fi."); });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(result.error || "Couldn't pair.", response.status);
  return result as T;
}

/** "482913" as "482 913", read from the sofa. */
export const groupedCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

/**
 * An unpaired TV shows a code and its QR; a paired admin's phone approves it (/pair/tv), and the TV, polling with the
 * request's secret, pairs by itself. A request lasts ten minutes; an expired one gives way to a new code.
 */
export function TvPairing({ status, onEnterCode }: { status: ReactNode; onEnterCode: () => void }) {
  const { pairingOrigin, savePairing, details } = useSessionGate();
  const titleId = useId();
  const request = useQuery({
    queryKey: ["tv-pairing", pairingOrigin],
    queryFn: () => pairingPost<{ code: string; secret: string }>(pairingOrigin, "/api/pair/tv", { id: deviceId(), name: localDeviceName() ?? defaultDeviceName(deviceId()) }),
    staleTime: Infinity, retry: false,
  });
  const { code, secret } = request.data ?? {};
  const poll = useQuery({
    queryKey: ["tv-pairing", pairingOrigin, code],
    queryFn: () => pairingPost<{ token?: string; installationId?: string }>(pairingOrigin, "/api/pair/tv/poll", { code, secret }),
    enabled: !!code, refetchInterval: 2_000, retry: false, gcTime: 0,
  });
  useEffect(() => {
    const { token, installationId } = poll.data ?? {};
    if (token && installationId) savePairing({ origin: pairingOrigin, token, installationId });
  }, [poll.data]);
  useEffect(() => { if (poll.error instanceof ApiError && poll.error.status === 404) void request.refetch(); }, [poll.error]);
  const name = details?.name ?? "Couch";
  // The QR opens this Couch's LAN address, which the phone reaches; this tab's own origin may be localhost.
  const base = new URL(details?.urls?.[0] ?? pairingOrigin);
  const link = code && `${base.origin}/pair/tv?code=${code}`;
  return <section aria-labelledby={titleId} className="mx-auto grid max-w-full flex-1 grid-cols-[minmax(0,36rem)_auto] content-center items-center gap-x-32 px-(--gutter) py-12">
    <div className="grid justify-items-start gap-8">
      <CouchMark className="size-10" />
      <h1 id={titleId} className="text-3xl font-semibold tracking-tight">Pair with {name}</h1>
      {code
        ? <p data-tv-pairing-code aria-label={`Code ${code.split("").join(" ")}`} className="-my-4 text-[7rem] leading-none font-semibold tracking-tight whitespace-pre tabular-nums">{groupedCode(code)}</p>
        : !request.isError && <p role="status" className="flex items-center gap-2 text-muted-foreground"><Spinner role="presentation" aria-hidden="true" aria-label={undefined} />Getting a code…</p>}
      {code && <p className="max-w-[34rem] text-muted-foreground">Scan with a phone paired with {name}, or open <span className="text-foreground">{base.origin}/pair/tv</span> and enter the code.</p>}
      {status}
      {request.isError && !request.isFetching && <Alert variant="destructive"><AlertDescription>{request.error.message}</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void request.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>}
      <Button variant="ghost" className="-ml-3" onClick={onEnterCode}>Enter a code instead</Button>
    </div>
    {/* The QR keeps a light ground so every phone camera can read it. */}
    {link && <div className="bg-foreground p-3"><QRCodeSVG value={link} size={336} marginSize={2} level="M" title={`Pair with code ${code}`} className="size-[14rem]" /></div>}
  </section>;
}
