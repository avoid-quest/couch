import type { ComponentProps } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Couch's Command has no surface of its own: it lives in the header's search (HeaderSearch), which draws the ground.
function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return <CommandPrimitive data-slot="command" className={cn("flex flex-col text-foreground", className)} {...props} />;
}

function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List data-slot="command-list" className={cn("scroll-py-1 overflow-x-hidden overflow-y-auto outline-none", className)} {...props} />;
}

// Headings read as the menus' labels.
function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return <CommandPrimitive.Group data-slot="command-group" className={cn("min-w-0 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:text-muted-foreground", className)} {...props} />;
}

// The selected item inverts as a menu's highlighted item does; the focus stays in the field.
function CommandItem({ className, children, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return <CommandPrimitive.Item data-slot="command-item" className={cn("group/command-item relative flex min-h-control touch:min-h-11 cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4", className)} {...props}>
    {children}
    <CheckIcon aria-hidden="true" className="ml-auto hidden group-data-[checked=true]/command-item:block" />
  </CommandPrimitive.Item>;
}

export { Command, CommandList, CommandGroup, CommandItem };
