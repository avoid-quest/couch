import { Fragment, useRef, useState, type ComponentProps, type HTMLAttributes, type MouseEvent, type PointerEvent, type ReactNode, type TouchEvent } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { startHold } from "@/hold";
import { PlayOnGroup, usePlayOn } from "./PlayOn";

/** One verb in a menu. playOn makes it "Play on", a group of the online Devices; node is its own item, such as a link. */
export type MenuAction = { label: string; disabled?: boolean; pressed?: boolean; run?: () => void; node?: ReactNode; playOn?: (deviceId: string) => void; sharingDeviceId?: string };

// Play on's devices are a labelled group, set apart from the verbs on either side.
function Items({ actions, on }: { actions: MenuAction[]; on: (label: string) => string }) {
  return actions.map((action, index) => action.node ? <DropdownMenuItem key={action.label} asChild>{action.node}</DropdownMenuItem>
    : action.playOn ? <Fragment key={action.label}><PlayOnGroup separated={index > 0} disabled={action.disabled} onPlay={action.playOn} sharingDeviceId={action.sharingDeviceId} />{index < actions.length - 1 && <DropdownMenuSeparator />}</Fragment>
    : <DropdownMenuItem key={action.label} disabled={action.disabled} onSelect={action.run}>{action.label === "Play" || action.label === "Resume" ? on(action.label) : action.label}</DropdownMenuItem>);
}

const own = (event: { currentTarget: Element; target: EventTarget }) => event.target instanceof Node && event.currentTarget.contains(event.target);
type ItemProps = Pick<HTMLAttributes<HTMLElement>, "className" | "onContextMenu" | "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onTouchEnd">;

/**
 * An item's one menu, for a row or a tile. Spread `item` on the item and `target` on its primary target (its press);
 * `ItemMenu` draws the "…" and the menu. Every way in opens it the same way: the "…"; right-click, the keyboard's
 * menu key and Shift+F10, which reach the item as `contextmenu`; a long press on touch; and a held OK on a remote,
 * which navigation.ts turns into `contextmenu` on a target marked `data-item-menu`.
 */
export function useItemMenu(actions: MenuAction[]) {
  const { devices, on } = usePlayOn();
  // Play on waits for a second online Device, so it alone never makes a menu.
  const shown = actions.filter(action => !action.playOn || devices.length > 0);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const press = useRef<{ release: () => boolean; x: number; y: number } | null>(null);
  const held = useRef(false);
  if (!shown.length) return { shown, on, open: false, setOpen, opener, item: {} as ItemProps, target: {} };
  // Focus comes back to what opened it: the control pressed, else the item's primary target.
  const openFrom = (item: HTMLElement, target: EventTarget) => {
    const control = target instanceof Element ? target.closest<HTMLElement>("button, a[href]") : null;
    opener.current = control && item.contains(control) ? control : item.querySelector<HTMLElement>("[data-item-menu]");
    setOpen(true);
  };
  const cancel = () => { press.current?.release(); press.current = null; };
  const item: ItemProps = {
    // No text selection or iOS link preview on a long press.
    className: "group/menu select-none [-webkit-touch-callout:none]",
    // A portal's events reach the item through React, so only the item's own open its menu.
    onContextMenu: (event: MouseEvent<HTMLElement>) => { event.preventDefault(); if (press.current) held.current = true; cancel(); if (own(event)) openFrom(event.currentTarget, event.target); },
    // iOS fires no contextmenu, so a touch held still opens the menu (Android fires one too, above).
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      held.current = false;
      if (event.pointerType !== "touch" || !own(event)) return;
      const { currentTarget: item, target } = event;
      press.current = { ...startHold(() => { held.current = true; openFrom(item, target); }), x: event.clientX, y: event.clientY };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => { if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) cancel(); },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // A long press ends without the mouse events, focus and click a tap makes, which would close the menu or press the item.
    onTouchEnd: (event: TouchEvent<HTMLElement>) => { if (held.current) event.preventDefault(); },
  };
  return { shown, on, open, setOpen, opener, item, target: { "data-item-menu": "" } };
}

/**
 * The item's "…" ("Options for {title}") and its one menu, a controlled DropdownMenu. It hangs from the "…", or from
 * the whole item where the "…" is hidden (a row whose page holds its verbs), so it opens in one place whatever opened
 * it. The "…" shows on touch screens, and elsewhere while the item is hovered or holds focus.
 */
export function ItemMenu({ menu, title, hidden = false, className, ...props }: { menu: ReturnType<typeof useItemMenu>; title: string; hidden?: boolean } & ComponentProps<typeof Button>) {
  const trigger = useRef<HTMLButtonElement>(null);
  const outside = useRef(false);
  if (!menu.shown.length) return null;
  return <DropdownMenu modal={false} open={menu.open} onOpenChange={open => { if (open) menu.opener.current = null; menu.setOpen(open); }}>
    <DropdownMenuTrigger asChild>{hidden ? <span aria-hidden="true" aria-label={`Options for ${title}`} className="pointer-events-none absolute inset-0" />
      : <Button ref={trigger} data-row-options variant="ghost" size="icon" aria-label={`Options for ${title}`} className={cn("opacity-0 group-hover/menu:opacity-100 group-focus-within/menu:opacity-100 data-[state=open]:opacity-100 touch:opacity-100", className)} {...props}><MoreHorizontal aria-hidden="true" /></Button>}</DropdownMenuTrigger>
    {/* Radix lands a keyboard or a remote (whose keys it hears) on the first verb, and leaves a pointer on the menu itself. */}
    <DropdownMenuContent align="end" onInteractOutside={() => { outside.current = true; }} onCloseAutoFocus={event => {
      event.preventDefault();
      // Back to the item or its "…", unless a press went elsewhere or Remove took the row away (its list moves focus on).
      const to = menu.opener.current ?? trigger.current;
      if (!outside.current && to?.isConnected) to.focus();
      outside.current = false;
    }}><Items actions={menu.shown} on={menu.on} /></DropdownMenuContent>
  </DropdownMenu>;
}
