import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { CouchMark } from "@/components/CouchMark";

/** First-run, pairing and setup screens: a page title, one line and the form. */
export function Onboarding({ title, description, back, children, className, ...props }: Omit<ComponentProps<"section">, "title"> & { title: ReactNode; description?: ReactNode; back?: ComponentProps<typeof PageHeader>["back"] }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-(--gutter) py-12", className)} {...props}>
      <div className="grid gap-2">
        <CouchMark className="mb-4 size-10" />
        <PageHeader id={id} title={title} back={back} className="mb-0 [&_h1]:whitespace-normal [&_h1]:break-words" />
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
