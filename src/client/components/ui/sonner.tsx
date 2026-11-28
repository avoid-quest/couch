import { Toaster as Sonner, type ToasterProps } from "sonner";
import { messagePlace, visibleToasts } from "@/toasts";
import { OctagonXIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

// Couch: one place for every message, the person's choice (This device → General): centred over the content, beside the
// side player (--content-inset-left or -right, index.css), at the bottom clear of the dock and tabs or the full player's controls
// (--bottom-bar), or at the top below the header (--top-bar) or the player's top band (--player-top). Sonner's own
// breakpoint (600px) uses mobileOffset. Two at most, both open: a remote can't hover.
const bottom = "calc(var(--bottom-bar, 0px) + 1.25rem)";
const top = "calc(var(--player-top, var(--top-bar, 3.5rem)) + 1rem)";
const offset = { left: "var(--gutter)", right: "var(--gutter)", top, bottom };
const mobileOffset = {
  left: "var(--gutter)",
  right: "var(--gutter)",
  top: "calc(var(--player-top, var(--top-bar, 3.5rem)) + .5rem)",
  bottom: "calc(var(--bottom-bar, 0px) + .75rem)",
};

const Toaster = ({
  tvPresentation = false,
  ...props
}: ToasterProps & { tvPresentation?: boolean }) => {
  // Sonner pauses every timer on hover. A parked TV pointer must not hold notices over a film.
  const ignoreHover: React.MouseEventHandler = (event) => {
    if (tvPresentation) event.stopPropagation();
  };
  const place = messagePlace.use();
  return (
    <div
      className="messages"
      data-ignore-hover={tvPresentation || undefined}
      onMouseOverCapture={ignoreHover}
      onMouseMoveCapture={ignoreHover}
    >
      <Sonner
        theme="dark"
        className="toaster group"
        position={`${place}-center`}
        offset={offset}
        mobileOffset={mobileOffset}
        visibleToasts={visibleToasts}
        expand
        icons={{ error: <OctagonXIcon className="size-5 text-destructive" /> }}
        style={{ fontFamily: "var(--font-sans)" }}
        toastOptions={{
          unstyled: true,
          classNames: {
            // A pill in ink on the dark room, hugging its words (index.css), its one action a dark capsule inside; an
            // Undo drains a thin bar over its time. A problem keeps the floating bar's dark surface and leads with its icon.
            toast:
              "flex items-center gap-1.5 rounded-[1.625rem] bg-primary py-1.5 pr-4.5 pl-4.5 text-sm font-medium text-primary-foreground shadow-[0_1.125rem_3rem_-0.75rem_rgb(0_0_0/80%)] has-[[data-button]]:pr-1.5 data-[type=error]:gap-3 data-[type=error]:rounded-xl data-[type=error]:bg-bar data-[type=error]:py-3 data-[type=error]:pr-4 data-[type=error]:pl-3 data-[type=error]:text-foreground data-[type=error]:shadow-(--float-shadow)",
            icon: "flex shrink-0",
            content: "min-w-0 py-1.5 in-data-[type=error]:py-0",
            title: "leading-snug wrap-anywhere",
            actionButton: cn(
              buttonVariants({ size: "sm" }),
              "shrink-0 bg-primary-foreground text-primary hover:bg-primary-foreground/85 active:bg-primary-foreground/70",
            ),
          },
        }}
        {...props}
      />
    </div>
  );
};

export { Toaster };
