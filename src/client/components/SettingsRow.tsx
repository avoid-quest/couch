import type { ReactNode } from "react";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/** A label on the left and its control on the right, divided from the next row. */
export function SettingsRow({ label, htmlFor, description, children, className }: { label: ReactNode; htmlFor?: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Field className={cn("grid items-start gap-x-8 gap-y-2 border-b py-3 *:w-auto md:grid-cols-[14rem_minmax(0,1fr)]", className)}>
      <FieldContent className="gap-0.5">
        {htmlFor ? <FieldLabel htmlFor={htmlFor} className="text-base font-normal">{label}</FieldLabel> : <FieldTitle className="text-base font-normal">{label}</FieldTitle>}
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </Field>
  );
}

/** A titled group of settings: rows, lists or short text. */
export function SettingsSection({ title, description, children, className }: { title?: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <FieldSet className={cn("gap-2", className)}>
      {title && <FieldLegend className="mb-0 text-base font-medium">{title}</FieldLegend>}
      {description && <FieldDescription>{description}</FieldDescription>}
      <div className="flex flex-col gap-3 border-t pt-3 has-[>[data-slot=field]:first-child]:gap-0 has-[>[data-slot=field]:first-child]:pt-0">{children}</div>
    </FieldSet>
  );
}
