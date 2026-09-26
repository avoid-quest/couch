import { useQuery } from "@tanstack/react-query";
import { pairingCodeQuery } from "@/api/controllers";
import { QRCodeSVG } from "qrcode.react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TRY_AGAIN } from "@/copy";

export function SetupQr({ url, credentials }: { url: string; credentials: { origin: string; token: string } }) {
  const pairing = useQuery(pairingCodeQuery(credentials));
  const code = pairing.data ?? null;
  const error = pairing.isError && !pairing.isFetching;
  const link = new URL(url);
  link.hash = code ? `pair=${code}` : "";
  if (error) return <Alert variant="destructive"><AlertDescription>Couldn't load the code.</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void pairing.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>;
  if (!code) return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner role="presentation" aria-label={undefined} aria-hidden="true" />Loading…</p>;
  // The QR keeps a light ground so every phone camera can read it.
  return <div className="grid min-w-0 justify-items-center gap-6 text-center sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:justify-items-start sm:text-left">
    <div role="img" aria-label={`Pair another device with code ${code}`} className="bg-foreground p-2"><QRCodeSVG value={link.href} size={160} marginSize={2} level="M" title="Pair another device" aria-hidden="true" className="size-40" /></div>
    <p className="grid min-w-0 gap-1"><span className="text-sm text-muted-foreground">Pairing code</span><strong data-pairing-code className="text-3xl font-semibold tracking-widest tabular-nums">{code}</strong></p>
  </div>;
}
