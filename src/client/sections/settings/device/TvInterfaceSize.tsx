import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { interfaceSizes, type TvAppearance } from "../../../../shared/appearance";
import type { Credentials } from "../../../session/session";
import { apiSend } from "@/api/client";
import { usePreviewSeconds } from "../../../interface-size";
import { InterfaceSizeChoices } from "./InterfaceSizeChoices";

export function TvInterfaceSize({ appearance, credentials, connected, administrator, native, hostName = "Couch", previewOnly = false }: {
  appearance: TvAppearance; credentials: Credentials | null; connected: boolean; administrator: boolean; native: boolean; hostName?: string; previewOnly?: boolean;
}) {
  const seconds = usePreviewSeconds(appearance);
  // The session snapshot carries the resulting appearance.
  const mutation = useMutation({ mutationFn: ({ path, input }: { path: string; input: object }) => apiSend(credentials!, `/api/appearance${path}`, input, "POST", 10_000) });
  const pending = mutation.isPending;
  const error = mutation.error ? mutation.error.message || "Could not change TV interface size." : null;
  const change = (path: string, input: object) => { if (credentials && !pending) mutation.mutate({ path, input }); };

  const canWrite = administrator && connected && !pending;
  return (
    <section className="space-y-3" aria-labelledby={previewOnly ? undefined : "tv-interface-size"} data-tv-local-only={native ? "" : undefined}>
      {!previewOnly && <>
        <h3 id="tv-interface-size">TV interface size</h3>
        <p className="text-muted-foreground">Shared by everyone watching {hostName}'s TV screen. Try a size there, then confirm it within 20 seconds.</p>
      </>}
      {administrator
        ? <div className="settings-choice-row grid grid-cols-[16rem_minmax(0,1fr)] items-center gap-4 border-t border-border py-3 max-[900px]:grid-cols-1"><span>Size</span><InterfaceSizeChoices label="TV interface size" value={seconds || !appearance.preview ? appearance.size : appearance.confirmedSize} disabled={!canWrite} onChange={size => void change("", { size })} /></div>
        : <p className="text-muted-foreground">{interfaceSizes.find(size => size.value === appearance.confirmedSize)?.label}. An administrator can change this TV's interface size.</p>}
      {appearance.preview && seconds > 0 && (
        <div className="space-y-3">
          <p role="status">Keep this TV interface size? Returning to the saved size in {seconds} seconds.</p>
          {administrator && (
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-11" disabled={!canWrite} onClick={() => change("/confirm", { previewId: appearance.preview!.id })}>Keep TV size</Button>
              <Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => change("/cancel", { previewId: appearance.preview!.id })}>Return to saved size</Button>
            </div>
          )}
        </div>
      )}
      {administrator && <Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => change("/reset", { size: 1 })}>Reset TV to default</Button>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
