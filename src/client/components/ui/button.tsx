import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-colors motion-reduce:transition-none outline-none select-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[1.15em]",
  {
    variants: {
      variant: {
        // One hover language (Design → Hover): a fill steps up one notch, ink comes up to white, and nothing changes
        // colour, tints or moves; a press steps back down. Keyboard focus inverts (index.css).
        default: "bg-primary text-primary-foreground hover:bg-primary/85 active:bg-primary/70",
        outline:
          "border-border text-foreground hover:border-foreground/40 active:border-foreground/25 aria-expanded:border-foreground/40",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-fill-hover active:bg-secondary aria-expanded:bg-fill-hover",
        ghost:
          "text-foreground/80 hover:text-foreground active:text-foreground/60 aria-expanded:text-foreground",
        destructive:
          "bg-destructive/15 text-destructive hover:bg-destructive/25 active:bg-destructive/15",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // Heights from the control scale (index.css): a capsule at every size, so focus inverts as a capsule too.
      size: {
        default:
          "h-control gap-1.5 px-3.5 text-sm touch:min-h-11 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-[1.15em]",
        xs: "h-6 gap-1 px-2.5 text-caption has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-control-sm gap-1 px-3 touch:min-h-11 text-sm has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-control-lg gap-2 px-5 text-body has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4 [&_svg:not([class*='size-'])]:size-[1.15em]",
        icon: "size-control touch:size-11 [&_svg:not([class*='size-'])]:size-[1.15em]",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-control-sm touch:size-11 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-10 touch:size-11 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
