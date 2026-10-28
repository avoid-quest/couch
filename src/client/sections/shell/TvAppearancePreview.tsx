import { useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TvAppearance } from "../../../shared/appearance";
import type { Credentials } from "@/session/session";
import { usePreviewSeconds } from "@/interface-size";
import { TvInterfaceSize } from "../settings/couch/TvInterfaceSize";

export function TvAppearancePreview({ appearance, credentials, connected }: { appearance: TvAppearance; credentials: Credentials | null; connected: boolean }) {
  const seconds = usePreviewSeconds(appearance);
  const opener = useRef<HTMLElement | null>(null);
  return <Dialog open={!!appearance.preview && seconds > 0}>
    <DialogContent showCloseButton={false} data-tv-local-only onEscapeKeyDown={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()}
      onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={event => {
        // A preview opened by a session snapshot has no DialogTrigger to return to.
        if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus({ preventScroll: true }); }
        opener.current = null;
      }}>
      <DialogHeader><DialogTitle>Keep this size?</DialogTitle><DialogDescription>Can you read everything?</DialogDescription></DialogHeader>
      <TvInterfaceSize appearance={appearance} credentials={credentials} connected={connected} administrator native previewOnly />
    </DialogContent>
  </Dialog>;
}
