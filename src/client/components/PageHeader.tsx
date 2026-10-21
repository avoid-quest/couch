import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Page or sub-page title with an optional back button and trailing actions. */
export function PageHeader({ title, description, back, actions, as: Heading = "h1", id, className }: { title: ReactNode; description?: ReactNode; back?: { label: string; onClick: () => void }; actions?: ReactNode; as?: "h1" | "h2"; id?: string; className?: string }) {
  return (
    <header className={cn("mb-8 flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3", back && "max-sm:grid max-sm:grid-cols-1", className)}>
      {back && <Button variant="ghost" data-back className="-ml-2.5 justify-self-start text-muted-foreground" onClick={back.onClick}><ChevronLeft aria-hidden="true" />{back.label}</Button>}
      <div className="min-w-0 flex-1 basis-48">
        <Heading id={id} tabIndex={-1} className="text-3xl font-semibold tracking-tight break-words outline-none">{title}</Heading>
        {description && <div className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
