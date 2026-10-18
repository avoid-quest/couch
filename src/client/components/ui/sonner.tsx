import { Toaster as Sonner, type ToasterProps } from "sonner"
import { visibleToasts } from "@/toasts"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// Couch: one placement, top right at the page gutter, below the header's row (min-h-14), or in the
// player below its top band (PlayerPage publishes --player-top). Two at most, both open: a remote can't hover.
const offset = { left: "var(--gutter)", right: "var(--gutter)", top: "calc(var(--player-top, 3.5rem) + 1rem)" }

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="top-right"
      offset={offset}
      mobileOffset={offset}
      visibleToasts={visibleToasts}
      expand
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          // In rem, so one line holds the same words as the type scales up to the TV.
          "--width": "24rem",
          fontFamily: "var(--font-sans)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // One line: the message truncates and the action stays in view.
          toast: "cn-toast shadow-none! text-sm!",
          content: "min-w-0",
          title: "truncate",
          actionButton: "h-8! text-sm! touch:min-h-11 touch:min-w-11 hover:opacity-80",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
