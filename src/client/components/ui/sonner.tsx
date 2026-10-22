import { useSyncExternalStore } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { visibleToasts } from "@/toasts"
import { OctagonXIcon } from "lucide-react"
import { buttonVariants } from "./button"

// Couch: top right at the page gutter, below the header's row (min-h-14), or in the player below its top band
// (PlayerPage publishes --player-top). Phones (sonner's own breakpoint) keep the top for the artwork: their toasts sit
// at the bottom, just above the footer or the player's band (--bottom-bar). Two at most, both open: a remote can't hover.
const offset = { left: "var(--gutter)", right: "var(--gutter)", top: "calc(var(--player-top, var(--top-bar, 3.5rem)) + 1rem)" }
const mobileOffset = { left: "var(--gutter)", right: "var(--gutter)", bottom: "calc(var(--bottom-bar, 0px) + .5rem)" }
const phoneQuery = "(max-width: 600px)"
const subscribePhone = (onChange: () => void) => { const media = window.matchMedia(phoneQuery); media.addEventListener("change", onChange); return () => media.removeEventListener("change", onChange) }
const isPhone = () => window.matchMedia(phoneQuery).matches

const Toaster = ({ tvPresentation = false, ...props }: ToasterProps & { tvPresentation?: boolean }) => {
  // Sonner pauses every timer on hover. A parked TV pointer must not hold notices over a film.
  const ignoreHover: React.MouseEventHandler = event => { if (tvPresentation) event.stopPropagation() }
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false)
  return (
    <div onMouseOverCapture={ignoreHover} onMouseMoveCapture={ignoreHover}>
      <Sonner
        theme="dark"
        className="toaster group"
        position={phone ? "bottom-right" : "top-right"}
        offset={offset}
        mobileOffset={mobileOffset}
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
            // Floats like the bar: its solid surface and shadow, no backdrop filter (docs/design.md, Glass). It hugs its
            // message (index.css), which wraps, with the verb beside it as a small capsule; an error leads with its icon.
            toast: "flex items-center gap-3 rounded-xl bg-bar py-3 pr-4 pl-4 text-sm text-foreground shadow-(--float-shadow) has-[[data-button]]:py-2 has-[[data-button]]:pr-2 has-[[data-icon]]:pl-3",
            icon: "flex shrink-0",
            content: "min-w-0",
            title: "font-medium leading-snug wrap-anywhere",
            actionButton: buttonVariants({ size: "sm" }),
          },
        }}
        {...props}
      />
    </div>
  )
}

export { Toaster }
