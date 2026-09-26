import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** First-run, pairing and setup screens: a display title, one line and the form. */
export function Onboarding({ title, description, children, className, ...props }: Omit<ComponentProps<"section">, "title"> & { title: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-(--gutter) py-12", className)} {...props}>
      <div className="grid gap-2">
        <h1 id={id} className="text-3xl font-semibold tracking-tight text-balance break-words">{title}</h1>
        {description && <p className="text-base text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
