import { Laptop, Smartphone, Tv, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionGate } from "@/session/session-context";

/** This device's kind as a glyph: the TV, a phone (touch) or a computer. */
export function DeviceGlyph({ className }: { className?: string }) {
  const { tvPresentation } = useSessionGate();
  const Icon = tvPresentation ? Tv : matchMedia("(pointer: coarse)").matches ? Smartphone : Laptop;
  return <Icon aria-hidden="true" className={className} />;
}

/** Who a page's changes reach, above its title: this device only, or everyone on the Couch. */
export function ScopeLine({ owner, couch }: { owner: "device" | "couch"; couch: string }) {
  return (
    <p
      className={cn(
        "inline-flex min-h-7 max-w-full items-center gap-2 justify-self-start rounded-full py-1 pr-3 pl-2.5 text-meta",
        owner === "couch"
          ? "bg-foreground font-medium text-background"
          : "text-muted-foreground ring-1 ring-border ring-inset",
      )}
    >
      {owner === "couch" ? (
        <Users aria-hidden="true" className="size-3.5 shrink-0" />
      ) : (
        <DeviceGlyph className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {owner === "couch"
          ? `Changes here are for everyone on ${couch}`
          : "Changes here stay on this device"}
      </span>
    </p>
  );
}
