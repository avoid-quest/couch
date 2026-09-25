import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function SetupQr({ url, credentials }: { url: string; credentials: { origin: string; token: string } }) {
  const [pairing, setPairing] = useState<{ code: string; origin: string; token: string } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPairing(null);
    setError(false);
    void fetch(`${credentials.origin}/api/controllers/pairing-code`, {
      headers: { Authorization: `Bearer ${credentials.token}` },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    }).then(async response => {
      const result = await response.json();
      if (!response.ok || !/^\d{6}$/.test(result.code)) throw new Error("Pairing code unavailable");
      if (!controller.signal.aborted) setPairing({ code: result.code, origin: credentials.origin, token: credentials.token });
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [credentials.origin, credentials.token, attempt]);
  const code = pairing?.token === credentials.token && pairing.origin === credentials.origin ? pairing.code : null;
  const link = new URL(url);
  link.hash = code ? `pair=${code}` : "";
  return <div className="min-w-0">
    {code ? <div className="grid justify-items-center gap-6 text-center sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:justify-items-start sm:text-left">
      <div role="img" aria-label={`Pair another device with code ${code}`} className="bg-white p-2"><QRCodeSVG value={link.href} size={160} marginSize={2} level="M" title="Pair another device" aria-hidden="true" className="size-40" /></div>
      <p className="grid min-w-0 gap-1"><span className="text-sm text-muted-foreground">Pairing code</span><strong data-pairing-code className="text-4xl font-semibold tracking-[.08em] tabular-nums">{code}</strong></p>
    </div> : error ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">Could not load the QR or pairing code. Retry to pair a device.</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry pairing QR</Button></div> : <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-4" />Loading pairing QR…</p>}
  </div>;
}
