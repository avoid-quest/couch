import { useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { isDesktop, subscribeDesktop } from "@/sections/shell/Outputs";
import { isTvPresentation } from "@/session/presentation";

/**
 * A panel one of a menu's rows opens once the menu has closed (a shared source's devices, a link's quality): a Popover
 * hanging from what opened the menu on desktops and the TV, a Sheet rising from the bottom on phones. It gives the focus
 * back to that control as it closes.
 */
export function MenuPanel({
  title,
  anchor,
  onClose,
  children,
}: {
  title: string;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const change = (open: boolean) => !open && onClose();
  const back = (event: Event) => {
    if (!anchor.current?.isConnected) return;
    event.preventDefault();
    anchor.current.focus();
  };
  if (desktop || isTvPresentation())
    return (
      <Popover open onOpenChange={change}>
        <PopoverAnchor virtualRef={anchor as RefObject<HTMLElement>} />
        <PopoverContent
          align="end"
          collisionPadding={16}
          aria-label={title}
          onCloseAutoFocus={back}
          className="max-h-(--radix-popover-content-available-height) w-72 gap-0 overflow-y-auto p-1"
        >
          {children}
        </PopoverContent>
      </Popover>
    );
  return (
    <Sheet open onOpenChange={change}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        onCloseAutoFocus={back}
        className="max-h-[85dvh] overflow-y-auto px-(--gutter) py-4"
      >
        <div className="mx-auto grid w-full max-w-3xl">
          <SheetTitle className="mb-2 pr-11 break-words">{title}</SheetTitle>
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
