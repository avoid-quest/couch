import { useMutation } from "@tanstack/react-query";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { SettingsRow } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ADMIN_ONLY } from "@/copy";
import { interfaceSizes, type InterfaceSize, type TvAppearance } from "../../../../shared/appearance";
import type { Credentials } from "../../../session/session";
import { apiSend } from "@/api/client";
import { usePreviewSeconds } from "../../../interface-size";

const sizeChoices = interfaceSizes.map(size => ({ value: String(size.value), label: size.label }));

/** The TV's shared text size: try a size there, then keep or revert it within 20 seconds. */
export function TvInterfaceSize({ appearance, credentials, connected, administrator, native, previewOnly = false }: {
  appearance: TvAppearance; credentials: Credentials | null; connected: boolean; administrator: boolean; native: boolean; previewOnly?: boolean;
}) {
  const seconds = usePreviewSeconds(appearance);
  // The session snapshot carries the resulting appearance.
  const mutation = useMutation({ mutationFn: ({ path, input }: { path: string; input: object }) => apiSend(credentials!, `/api/appearance${path}`, input, "POST", 10_000) });
  const pending = mutation.isPending;
  const change = (path: string, input: object) => { if (credentials && !pending) mutation.mutate({ path, input }); };
  const canWrite = administrator && connected && !pending;
  const previewing = !!appearance.preview && seconds > 0;
  const countdown = `Reverting in ${seconds} s.`;
  const confirmed = interfaceSizes.find(size => size.value === appearance.confirmedSize)?.label;

  return (
    <>
      <SettingsRow data-tv-local-only={native ? "" : undefined} label="Text size" description={administrator ? previewOnly ? undefined : "Try a size, then confirm within 20 seconds." : ADMIN_ONLY}>
        {administrator ? <>
          <ChoiceGroup label="TV interface size" value={String(seconds || !appearance.preview ? appearance.size : appearance.confirmedSize)} options={sizeChoices} disabled={!canWrite} onValueChange={size => change("", { size: Number(size) as InterfaceSize })} />
        </> : <span className="text-sm">{confirmed}</span>}
      </SettingsRow>
      {previewing && (
        <SettingsRow role="status" label={previewOnly ? countdown : "Keep this size?"} description={previewOnly ? undefined : countdown} data-tv-local-only={native ? "" : undefined}>
          {administrator && <>
            <Button disabled={!canWrite} onClick={() => change("/confirm", { previewId: appearance.preview!.id })}>Keep</Button>
            <Button variant="outline" disabled={!canWrite} onClick={() => change("/cancel", { previewId: appearance.preview!.id })}>Revert</Button>
          </>}
        </SettingsRow>
      )}
      {mutation.error && <Alert variant="destructive"><AlertDescription>{mutation.error.message || "Couldn't change the TV text size."}</AlertDescription></Alert>}
    </>
  );
}
