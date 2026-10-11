import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Page or sub-page title with an optional back button and trailing actions. */
export function PageHeader({ title, back, actions, as: Heading = "h1", id, className }: { title: ReactNode; back?: { label: string; onClick: () => void }; actions?: ReactNode; as?: "h1" | "h2"; id?: string; className?: string }) {
  return (
    <header className={cn("mb-6 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-3", className)}>
      {back && <Button variant="ghost" data-back className="-ml-2.5 text-muted-foreground" onClick={back.onClick}><ChevronLeft aria-hidden="true" />{back.label}</Button>}
      <Heading id={id} tabIndex={-1} className="min-w-0 flex-1 basis-full truncate text-2xl font-semibold tracking-tight outline-none sm:basis-auto">{title}</Heading>
      {actions && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
    </header>
  );
}
