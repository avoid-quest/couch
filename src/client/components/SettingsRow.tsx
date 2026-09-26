import { Children, type ComponentProps, type ReactNode } from "react";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/** A label on the left and its control on the right, divided from the next row. */
export function SettingsRow({ label, htmlFor, description, children, className, ...props }: Omit<ComponentProps<"div">, "children"> & { label: ReactNode; htmlFor?: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <Field className={cn("grid items-start gap-x-8 gap-y-2 border-b py-3 *:w-auto md:grid-cols-[14rem_minmax(0,1fr)]", className)} {...props}>
      <FieldContent className="min-w-0 gap-0.5">
        {htmlFor ? <FieldLabel htmlFor={htmlFor} className="text-base font-normal">{label}</FieldLabel> : <FieldTitle className="min-w-0 text-base font-normal break-words">{label}</FieldTitle>}
        {description && <FieldDescription className="break-words">{description}</FieldDescription>}
      </FieldContent>
      {children && <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-2">{children}</div>}
    </Field>
  );
}

/**
 * A titled group of settings. Rows sit flush and divided; anything else
 * (status lines, alerts, short text) gets breathing room above it.
 */
export function SettingsSection({ title, description, children, className, ...props }: Omit<ComponentProps<"fieldset">, "title" | "children"> & { title?: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <FieldSet className={cn("min-w-0 gap-2", className)} {...props}>
      {title && <FieldLegend className="mb-0 data-[variant=legend]:text-base font-medium">{title}</FieldLegend>}
      {description && <FieldDescription className="nth-last-2:mt-0 [[data-variant=legend]+&]:mt-0">{description}</FieldDescription>}
      {Children.toArray(children).length > 0 && <div className="flex min-w-0 flex-col border-t [&>:not([data-slot=field])]:mt-3">{children}</div>}
    </FieldSet>
  );
}
