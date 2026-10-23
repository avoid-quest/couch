import * as React from "react"
import { cn } from "@/lib/utils"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"

// Authored locally from the Mira dialog styles: the shadcn registry is not
// reachable from every build environment. Same API as shadcn's AlertDialog.
function AlertDialog({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

function AlertDialogContent({ className, onOpenAutoFocus, onCloseAutoFocus, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  const opener = React.useRef<HTMLElement | null>(null);
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay
        data-slot="alert-dialog-overlay"
        className="fixed inset-0 isolate z-[100] bg-black/80 duration-150 ease-out motion-safe:data-open:animate-in data-open:fade-in-0"
      />
      <AlertDialogPrimitive.Content
        data-slot="dialog-content"
        onOpenAutoFocus={event => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={event => {
          onCloseAutoFocus?.(event);
          // Controlled confirmations (including row-menu actions) have no AlertDialogTrigger for Radix to restore.
          if (!event.defaultPrevented && opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); }
        }}
        className={cn(
          "fixed top-1/2 left-1/2 z-[101] grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-5 overflow-y-auto rounded-lg bg-popover p-6 text-sm text-popover-foreground ring-1 ring-border duration-150 ease-out outline-none sm:max-w-md motion-safe:data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
          className
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-header" className={cn("flex flex-col gap-1.5", className)} {...props} />
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-footer" className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return <AlertDialogPrimitive.Title data-slot="alert-dialog-title" className={cn("font-heading text-lg font-semibold tracking-tight", className)} {...props} />
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return <AlertDialogPrimitive.Description data-slot="alert-dialog-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
}

function AlertDialogAction({ className, variant = "default", ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Action> & Pick<React.ComponentProps<typeof Button>, "variant">) {
  return <Button variant={variant} asChild><AlertDialogPrimitive.Action data-slot="alert-dialog-action" className={className} {...props} /></Button>
}

function AlertDialogCancel({ className, variant = "ghost", ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> & Pick<React.ComponentProps<typeof Button>, "variant">) {
  return <Button variant={variant} asChild><AlertDialogPrimitive.Cancel data-slot="alert-dialog-cancel" className={className} {...props} /></Button>
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
}
