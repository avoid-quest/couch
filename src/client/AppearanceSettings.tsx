import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { defaultTvAppearance, interfaceSizes, type InterfaceSize, type TvAppearance } from "../shared/appearance";
import type { Credentials } from "./session";
import { saveRemoteInterfaceSize, usePreviewSeconds, useRemoteInterfaceSize } from "./interface-size";

export function InterfaceSizeChoices({ label, value, disabled, onChange }: {
  label: string; value: InterfaceSize; disabled?: boolean; onChange: (value: InterfaceSize) => void;
}) {
  return <div role="group" aria-label={label} className="interface-size-choices">
    {interfaceSizes.map(size => <Button key={size.value} variant={value === size.value ? "secondary" : "outline"} aria-pressed={value === size.value} disabled={disabled} onClick={() => onChange(size.value)}>{size.label}</Button>)}
  </div>;
}

function TvInterfaceSize({ appearance, credentials, connected, administrator, native, previewOnly = false }: {
  appearance: TvAppearance; credentials: Credentials | null; connected: boolean; administrator: boolean; native: boolean; previewOnly?: boolean;
}) {
  const seconds = usePreviewSeconds(appearance);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => () => mutation.current?.abort(), [credentials?.origin, credentials?.token]);
  const change = async (path: string, input: object) => {
    if (!credentials || pending) return;
    setPending(true); setError(null);
    const controller = new AbortController();
    mutation.current = controller;
    try {
      const response = await fetch(`${credentials.origin}/api/appearance${path}`, {
        method: "POST", headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(input), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not change TV interface size.");
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not change TV interface size.");
    } finally { if (!controller.signal.aborted) setPending(false); }
  };
  const canWrite = administrator && connected && !pending;
  return <section className="space-y-3" aria-labelledby={previewOnly ? undefined : "tv-interface-size"} data-tv-local-only={native ? "" : undefined}>
    {!previewOnly && <><h3 id="tv-interface-size">TV interface size</h3><p className="text-muted-foreground">Shared by everyone watching this TV. Try a size, check the TV, then confirm it within 20 seconds.</p></>}
    {administrator && !previewOnly && <InterfaceSizeChoices label="TV interface size" value={seconds || !appearance.preview ? appearance.size : appearance.confirmedSize} disabled={!canWrite} onChange={size => void change("", { size })} />}
    {!administrator && <p className="text-muted-foreground">{interfaceSizes.find(size => size.value === appearance.confirmedSize)?.label}. An administrator can change this TV's interface size.</p>}
    {appearance.preview && seconds > 0 && <div className="space-y-3">
      <p role="status">Keep this TV interface size? Returning to the saved size in {seconds} seconds.</p>
      {administrator && <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" disabled={!canWrite} onClick={() => void change("/confirm", { previewId: appearance.preview!.id })}>Keep TV size</Button>
        <Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => void change("/cancel", { previewId: appearance.preview!.id })}>Return to saved size</Button>
      </div>}
    </div>}
    {administrator && <Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => void change("/reset", { size: 1 })}>Reset TV to default</Button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function TvAppearancePreview({ appearance, credentials, connected }: { appearance: TvAppearance; credentials: Credentials | null; connected: boolean }) {
  const seconds = usePreviewSeconds(appearance);
  return <Dialog open={!!appearance.preview && seconds > 0}>
    <DialogContent className="text-base sm:max-w-lg" showCloseButton={false} data-tv-local-only onEscapeKeyDown={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()}>
      <DialogHeader><DialogTitle className="text-lg">TV interface size preview</DialogTitle><DialogDescription>Check that you can read the text and reach the controls.</DialogDescription></DialogHeader>
      <TvInterfaceSize appearance={appearance} credentials={credentials} connected={connected} administrator native previewOnly />
    </DialogContent>
  </Dialog>;
}

export function AppearanceSettings({ native, credentials, connected, administrator, appearance = defaultTvAppearance }: {
  native: boolean; credentials: Credentials | null; connected: boolean; administrator: boolean; appearance?: TvAppearance;
}) {
  const size = useRemoteInterfaceSize();
  const [notice, setNotice] = useState<string | null>(null);
  const change = (value: InterfaceSize) => setNotice(saveRemoteInterfaceSize(value) ? null : "Changed for this visit. Allow browser storage to keep this size after reloading.");
  return <div className="space-y-5">
    <TvInterfaceSize appearance={appearance} credentials={credentials} connected={connected} administrator={administrator} native={native} />
    {!native && <section className="space-y-3" aria-labelledby="remote-interface-size">
      <h3 id="remote-interface-size">This remote interface size</h3>
      <p className="text-muted-foreground">Text and controls in this browser. Other remotes keep their own size.</p>
      <InterfaceSizeChoices label="This remote interface size" value={size} onChange={change} />
      <Button variant="outline" className="min-h-11" onClick={() => change(1)}>Reset this remote to default</Button>
      {notice && <p role="status">{notice}</p>}
    </section>}
    <p className="text-muted-foreground">Interface size does not change the video picture or subtitles.</p>
  </div>;
}
