import { useQuery } from "@tanstack/react-query";
import { pairingCodeQuery } from "@/api/controllers";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function SetupQr({ url, credentials }: { url: string; credentials: { origin: string; token: string } }) {
  const pairing = useQuery(pairingCodeQuery(credentials));
  const code = pairing.data ?? null;
  const error = pairing.isError && !pairing.isFetching;
  const link = new URL(url);
  link.hash = code ? `pair=${code}` : "";
  return <div className="min-w-0">
    {code ? <div className="grid justify-items-center gap-6 text-center sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:justify-items-start sm:text-left">
      <div role="img" aria-label={`Pair another device with code ${code}`} className="bg-white p-2"><QRCodeSVG value={link.href} size={160} marginSize={2} level="M" title="Pair another device" aria-hidden="true" className="size-40" /></div>
      <p className="grid min-w-0 gap-1"><span className="text-sm text-muted-foreground">Pairing code</span><strong data-pairing-code className="text-4xl font-semibold tracking-[.08em] tabular-nums">{code}</strong></p>
    </div> : error ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">Could not load the QR or pairing code. Retry to pair a device.</p><Button variant="outline" onClick={() => void pairing.refetch()}>Retry pairing QR</Button></div> : <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-4" />Loading pairing QR…</p>}
  </div>;
}
