import type { ComponentProps } from "react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

// Clock's menu, as dropdown-menu.tsx draws it: hairline border, no shadow, text-sm items that invert when highlighted.
const ContextMenu = ContextMenuPrimitive.Root;
function ContextMenuTrigger({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" className={cn("select-none", className)} {...props} />;
}

function ContextMenuContent({ className, collisionPadding = 8, ...props }: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return <ContextMenuPrimitive.Portal><ContextMenuPrimitive.Content data-slot="context-menu-content" collisionPadding={collisionPadding} className={cn("z-[110] min-w-44 max-h-[calc(var(--radix-context-menu-content-available-height)/var(--interface-scale))] overflow-y-auto overflow-x-hidden rounded-md border bg-popover p-1 text-popover-foreground outline-none", className)} {...props} /></ContextMenuPrimitive.Portal>;
}

const item = "relative flex min-h-8 touch:min-h-11 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4";
function ContextMenuItem({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return <ContextMenuPrimitive.Item data-slot="context-menu-item" className={cn(item, className)} {...props} />;
}

const ContextMenuGroup = ContextMenuPrimitive.Group;
function ContextMenuLabel({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Label>) {
  return <ContextMenuPrimitive.Label className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)} {...props} />;
}

function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuGroup, ContextMenuLabel };
