import { Toaster as Sonner, type ToasterProps } from "sonner"
import { visibleToasts } from "@/toasts"
import { OctagonXIcon } from "lucide-react"
import { buttonVariants } from "./button"

// Couch: one placement, top right at the page gutter, below the header's row (min-h-14), or in the
// player below its top band (PlayerPage publishes --player-top). Two at most, both open: a remote can't hover.
const offset = { left: "var(--gutter)", right: "var(--gutter)", top: "calc(var(--player-top, var(--top-bar, 3.5rem)) + 1rem)" }

const Toaster = ({ tvPresentation = false, ...props }: ToasterProps & { tvPresentation?: boolean }) => {
  // Sonner pauses every timer on hover. A parked TV pointer must not hold notices over a film.
  const ignoreHover: React.MouseEventHandler = event => { if (tvPresentation) event.stopPropagation() }
  return (
    <div onMouseOverCapture={ignoreHover} onMouseMoveCapture={ignoreHover}>
      <Sonner
        theme="dark"
        className="toaster group"
        position="top-right"
        offset={offset}
        mobileOffset={offset}
        visibleToasts={visibleToasts}
        expand
        icons={{ error: <OctagonXIcon className="size-5 text-destructive" /> }}
        style={
          {
            "--width": "min(28rem, calc(100vw - 2 * var(--gutter)))",
            fontFamily: "var(--font-sans)",
          } as React.CSSProperties
        }
        toastOptions={{
          unstyled: true,
          classNames: {
            // The same flat left rule as Alert; messages wrap and the verb keeps its target.
            toast: "flex w-full items-center gap-3 border-l-2 border-foreground/40 bg-background p-4 text-sm text-foreground shadow-none data-[type=error]:border-destructive",
            content: "min-w-0 flex-1",
            title: "font-medium leading-snug wrap-anywhere",
            actionButton: buttonVariants(),
          },
        }}
        {...props}
      />
    </div>
  )
}

export { Toaster }
