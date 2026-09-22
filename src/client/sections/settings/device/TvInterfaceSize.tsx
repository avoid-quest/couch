import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { interfaceSizes, type TvAppearance } from "../../../../shared/appearance";
import type { Credentials } from "../../../session/session";
import { usePreviewSeconds } from "../../../interface-size";
import { InterfaceSizeChoices } from "./InterfaceSizeChoices";

export function TvInterfaceSize({ appearance, credentials, connected, administrator, native, hostName = "Couch", previewOnly = false }: {
  appearance: TvAppearance; credentials: Credentials | null; connected: boolean; administrator: boolean; native: boolean; hostName?: string; previewOnly?: boolean;
}) {
  const seconds = usePreviewSeconds(appearance);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), [credentials?.origin, credentials?.token]);

  async function change(path: string, input: object) {
    if (!credentials || pending) return;
    setPending(true); setError(null);
    const requestController = new AbortController();
    request.current = requestController;
    try {
      const response = await fetch(`${credentials.origin}/api/appearance${path}`, {
        method: "POST", headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(input), signal: AbortSignal.any([requestController.signal, AbortSignal.timeout(10_000)]),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not change TV interface size.");
    } catch (reason) {
      if (!requestController.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not change TV interface size.");
    } finally { if (!requestController.signal.aborted) setPending(false); }
  }

  const canWrite = administrator && connected && !pending;
  return (
    <section className="space-y-3" aria-labelledby={previewOnly ? undefined : "tv-interface-size"} data-tv-local-only={native ? "" : undefined}>
      {!previewOnly && <>
        <h3 id="tv-interface-size">TV interface size</h3>
        <p className="text-muted-foreground">Shared by everyone watching {hostName}'s TV screen. Try a size there, then confirm it within 20 seconds.</p>
      </>}
      {administrator
        ? <InterfaceSizeChoices label="TV interface size" value={seconds || !appearance.preview ? appearance.size : appearance.confirmedSize} disabled={!canWrite} onChange={size => void change("", { size })} />
        : <p className="text-muted-foreground">{interfaceSizes.find(size => size.value === appearance.confirmedSize)?.label}. An administrator can change this TV's interface size.</p>}
      {appearance.preview && seconds > 0 && (
        <div className="space-y-3">
          <p role="status">Keep this TV interface size? Returning to the saved size in {seconds} seconds.</p>
          {administrator && (
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-11" disabled={!canWrite} onClick={() => void change("/confirm", { previewId: appearance.preview!.id })}>Keep TV size</Button>
              <Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => void change("/cancel", { previewId: appearance.preview!.id })}>Return to saved size</Button>
            </div>
          )}
        </div>
      )}
      {administrator && <Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => void change("/reset", { size: 1 })}>Reset TV to default</Button>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
