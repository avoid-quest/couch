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
  return <div className="shrink-0 space-y-2">
    {code ? <><QRCodeSVG value={link.href} size={160} marginSize={4} level="M" title="Pair another device" className="h-40 w-40 rounded-md" /><p className="text-sm text-muted-foreground">Scan to pair a device</p></> : error ? <><p role="alert">Could not load the QR. Use the address and TV code, or retry.</p><Button variant="outline" className="min-h-11" onClick={() => setAttempt(value => value + 1)}>Retry pairing QR</Button></> : <p role="status" className="flex items-center gap-2"><Spinner className="size-3.5" />Loading pairing QR…</p>}
  </div>;
}
