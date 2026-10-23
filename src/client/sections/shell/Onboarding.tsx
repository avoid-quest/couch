import { useId, type ComponentProps, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CouchMark } from "@/components/CouchMark";
import { StageTitle } from "@/components/Stage";

/**
 * First-run, pairing and setup screens, staged as a Details page without artwork: the graphite room fills the window,
 * the question is set in display type at the left, and Couch's mark stands at the right where a picture would (a
 * step's own `object`, such as a QR, takes its place). `embedded` sets it inside a page instead: no room, a small mark.
 */
export function Onboarding({ title, description, back, step, object, embedded = false, children, className, ...props }: Omit<ComponentProps<"section">, "title"> & {
  title: string; description?: ReactNode; back?: { label: string; onClick: () => void }; step?: { current: number; total: number }; object?: ReactNode; embedded?: boolean;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-embedded={embedded || undefined} className={cn("onboarding relative isolate flex w-full flex-1 flex-col justify-center py-12", !embedded && "px-(--gutter)", className)} {...props}>
      {!embedded && <div aria-hidden="true" className="room" />}
      <div className={cn("mx-auto grid w-full items-center gap-x-[8vw] gap-y-10", embedded ? "max-w-xl" : "max-w-6xl lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]")}>
        <div className="@container grid min-w-0 gap-8">
          <div className="grid w-full justify-items-start gap-4">
            {(embedded || !object) && <CouchMark className={cn("mb-2 size-10", !embedded && "lg:hidden")} />}
            {back && <Button variant="ghost" data-back className="-ml-3.5 text-muted-foreground" onClick={back.onClick}><ChevronLeft aria-hidden="true" />{back.label}</Button>}
            {step && <Steps {...step} />}
            <StageTitle id={id} title={title} />
            {description && <div className="grid max-w-prose gap-3 text-body text-muted-foreground">{description}</div>}
          </div>
          {children}
        </div>
        {!embedded && <div className={cn("flex justify-center", object ? "max-lg:row-start-1 max-lg:justify-start" : "max-lg:hidden")}>
          {object ?? <CouchMark className="size-[min(22vw,15rem)]" />}
        </div>}
      </div>
    </section>
  );
}

/** Where a sequence stands: one short capsule per step, lit up to the current one. */
function Steps({ current, total }: { current: number; total: number }) {
  return <div role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current} aria-valuetext={`Step ${current} of ${total}`} className="flex gap-1.5">
    {Array.from({ length: total }, (_, index) => <span key={index} className={cn("h-1 w-8 rounded-full", index < current ? "bg-foreground" : "bg-foreground/20")} />)}
  </div>;
}
