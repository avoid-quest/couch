import { isValidElement, type ReactElement, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const backClassName = "-ml-2.5 justify-self-start text-muted-foreground";

/** A quiet link to the page above this one ("‹ Discover"), over the page's own title. */
export function BackLink({ label, to }: { label: string; to: string }) {
  return <Button variant="ghost" asChild className={backClassName}><Link to={to}><ChevronLeft aria-hidden="true" />{label}</Link></Button>;
}

/**
 * A page's h1, with an optional way back above it (a button, or a BackLink to the page above) and trailing actions. `hidden` keeps the h1 for screen readers
 * and focus only: a tab or a rail item that is selected already names the page.
 */
export function PageHeader({ title, back, actions, hidden = false, as: Heading = "h1", id, className }: { title: ReactNode; back?: { label: string; onClick: () => void } | ReactElement; actions?: ReactNode; hidden?: boolean; as?: "h1" | "h2"; id?: string; className?: string }) {
  const heading = <Heading id={id} tabIndex={-1} className={hidden ? "sr-only" : "min-w-0 flex-1 basis-48 text-3xl font-semibold tracking-tight break-words outline-none"}>{title}</Heading>;
  if (hidden && !back && !actions) return heading;
  return (
    <header className={cn("mb-8 grid min-w-0 gap-2", className)}>
      {isValidElement(back) ? back : back && <Button variant="ghost" data-back className={backClassName} onClick={back.onClick}><ChevronLeft aria-hidden="true" />{back.label}</Button>}
      <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3">
        {heading}
        {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
