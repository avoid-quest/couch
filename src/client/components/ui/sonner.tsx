import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// Couch: one placement at the page gutter, above whatever bar is at the
// bottom (the shell footer or the player band publish --bottom-bar).
const offset = { left: "var(--gutter)", right: "var(--gutter)", bottom: "calc(var(--bottom-bar, 0px) + 1rem)" }

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="bottom-right"
      offset={offset}
      mobileOffset={offset}
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
          fontFamily: "var(--font-sans)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // One line: the message truncates and the action stays in view.
          toast: "cn-toast shadow-none! text-sm!",
          content: "min-w-0",
          title: "truncate",
          actionButton: "touch:min-h-11 touch:min-w-11 hover:opacity-80",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
