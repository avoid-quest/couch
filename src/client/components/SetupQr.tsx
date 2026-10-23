import { useQuery } from "@tanstack/react-query";
import { pairingCodeQuery } from "@/api/devices";
import { QRCodeSVG } from "qrcode.react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TRY_AGAIN } from "@/copy";
import { groupedCode } from "@/sections/shell/TvPairing";

export function SetupQr({ url, credentials }: { url: string; credentials: { origin: string; token: string } }) {
  const pairing = useQuery(pairingCodeQuery(credentials));
  const code = pairing.data ?? null;
  const error = pairing.isError && !pairing.isFetching;
  const link = new URL(url);
  link.hash = code ? `pair=${code}` : "";
  if (error) return <Alert variant="destructive"><AlertDescription>Couldn't load the code.</AlertDescription><AlertAction><Button variant="ghost" size="sm" onClick={() => void pairing.refetch()}>{TRY_AGAIN}</Button></AlertAction></Alert>;
  if (!code) return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner role="presentation" aria-label={undefined} aria-hidden="true" />Loading…</p>;
  // The QR keeps a light ground so every phone camera can read it.
  return <figure className="grid min-w-0 justify-items-center gap-5">
    <div className="rounded-sm bg-foreground p-3 shadow-(--object-shadow)"><QRCodeSVG value={link.href} size={256} marginSize={2} level="M" title={`Pair with code ${code}`} className="size-[min(56vw,15rem)]" /></div>
    <figcaption data-pairing-code aria-label={`Code ${code.split("").join(" ")}`} className="font-display text-5xl font-semibold whitespace-pre tabular-nums">{groupedCode(code)}</figcaption>
  </figure>;
}
