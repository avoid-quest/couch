import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A page's h1, with an optional way back or the page's ancestors (ContentBreadcrumb) above it and trailing actions. `hidden` keeps the h1 for screen
 * readers and focus only: a tab or a rail item that is selected already names the page ("md": from md up, where the rail shows).
 */
export function PageHeader({ title, back, breadcrumb, actions, hidden = false, as: Heading = "h1", id, className }: { title: ReactNode; back?: { label: string; onClick: () => void }; breadcrumb?: ReactNode; actions?: ReactNode; hidden?: boolean | "md"; as?: "h1" | "h2"; id?: string; className?: string }) {
  const heading = <Heading id={id} tabIndex={-1} className={hidden === true ? "sr-only" : cn("min-w-0 flex-1 basis-48 text-4xl leading-tight font-semibold tracking-[-.025em] break-words outline-none", hidden && "md:sr-only")}>{title}</Heading>;
  if (hidden === true && !back && !breadcrumb && !actions) return heading;
  return (
    <header className={cn("mb-8 grid min-w-0 gap-2", className)}>
      {back && <Button variant="ghost" data-back className="-ml-2.5 justify-self-start text-muted-foreground" onClick={back.onClick}><ChevronLeft aria-hidden="true" />{back.label}</Button>}
      {breadcrumb}
      <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3">
        {heading}
        {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
