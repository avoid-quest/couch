"use client"

import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function ScrollArea({
  className,
  children,
  viewportProps,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportProps?: React.ComponentProps<typeof ScrollAreaPrimitive.Viewport>
}) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn("relative", className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        {...viewportProps}
        data-slot="scroll-area-viewport"
        className={cn("size-full outline-none focus-visible:outline-1", viewportProps?.className)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({ className, ...props }: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation="vertical"
      className={cn("flex w-2.5 touch-none select-none p-px", className)}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb data-slot="scroll-area-thumb" className="relative flex-1 rounded-full bg-border" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
