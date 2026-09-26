import { useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Artwork and title can open the same preview; closing returns to the exact opener. */
export function MediaDetails({ title, meta, description, art, actions, children }: {
  title: string; meta?: ReactNode; description?: string; art?: ReactNode; actions?: ReactNode;
  children: (inspect: (event?: MouseEvent<HTMLElement>) => void) => ReactNode;
}) {
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  return <Dialog open={open} onOpenChange={setOpen}>
    {children(event => { opener.current = event?.currentTarget ?? document.activeElement as HTMLElement; setOpen(true); })}
    <DialogContent aria-describedby={meta ? descriptionId : undefined} className="max-h-[90dvh] overflow-y-auto" onCloseAutoFocus={event => {
      event.preventDefault();
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    }}>
      {art && <div aria-hidden="true" className="grid max-h-64 place-items-center overflow-hidden [&_img]:max-h-64 [&_img]:object-contain">{art}</div>}
      <DialogHeader><DialogTitle>{title}</DialogTitle>{meta && <DialogDescription id={descriptionId}>{meta}</DialogDescription>}</DialogHeader>
      {description && <p className="whitespace-pre-line text-sm leading-relaxed break-words">{description}</p>}
      {actions && <div className="flex flex-wrap gap-1">{actions}</div>}
    </DialogContent>
  </Dialog>;
}
