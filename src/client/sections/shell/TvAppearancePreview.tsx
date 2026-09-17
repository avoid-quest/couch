import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TvAppearance } from "../../../shared/appearance";
import type { Credentials } from "@/session/session";
import { usePreviewSeconds } from "@/interface-size";
import { TvInterfaceSize } from "../settings/device/TvInterfaceSize";

export function TvAppearancePreview({ appearance, credentials, connected }: { appearance: TvAppearance; credentials: Credentials | null; connected: boolean }) {
  const seconds = usePreviewSeconds(appearance);
  return <Dialog open={!!appearance.preview && seconds > 0}>
    <DialogContent className="text-base" showCloseButton={false} data-tv-local-only onEscapeKeyDown={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()}>
      <DialogHeader><DialogTitle className="text-lg">TV interface size preview</DialogTitle><DialogDescription>Check that you can read the text and reach the controls.</DialogDescription></DialogHeader>
      <TvInterfaceSize appearance={appearance} credentials={credentials} connected={connected} administrator native previewOnly />
    </DialogContent>
  </Dialog>;
}
