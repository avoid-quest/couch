import { Children, type ComponentProps, type ReactNode } from "react";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * A label on the left and its control on the right, divided from the next row. Side by side, a one-line label centres on
 * its control's line; every control starts on the column's edge: a ghost button's text, and a choice's label with its
 * check hung in the gutter.
 */
export function SettingsRow({ label, htmlFor, description, children, className, ...props }: Omit<ComponentProps<"div">, "children"> & { label: ReactNode; htmlFor?: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <Field className={cn("grid items-start gap-x-8 gap-y-3 border-b border-border/60 py-5 *:w-auto @2xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]", className)} {...props}>
      <FieldContent className="min-w-0 gap-1">
        {htmlFor ? <FieldLabel htmlFor={htmlFor} className={cn("items-center", labelLine)}>{label}</FieldLabel> : <FieldTitle className={cn("min-w-0 break-words", labelLine)}>{label}</FieldTitle>}
        {description && <FieldDescription className="max-w-[46ch] text-pretty break-words">{description}</FieldDescription>}
      </FieldContent>
      {Children.toArray(children).length > 0 && <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-2 @2xl:-mt-[0.3125rem] @2xl:touch:mt-0 [&>[data-slot=toggle-group]]:-ml-2 @2xl:[&>[data-slot=toggle-group]]:-ml-8 [&>[data-variant=ghost]:first-child]:-ml-2.5">{children}</div>}
    </Field>
  );
}

// A label's line is 1.375rem and a control's 2rem: the control rises by half the difference. Touch controls are taller,
// so there the label's line grows to theirs instead.
const labelLine = "text-body font-medium @2xl:touch:min-h-11";

/**
 * A titled group of settings. Rows sit flush and divided; anything else
 * (status lines, alerts, short text) gets breathing room above it.
 */
export function SettingsSection({ title, description, children, className, ...props }: Omit<ComponentProps<"fieldset">, "title" | "children"> & { title?: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <FieldSet className={cn("min-w-0 gap-2", className)} {...props}>
      {title && <FieldLegend className="mb-0 font-heading data-[variant=legend]:text-heading font-semibold">{title}</FieldLegend>}
      {description && <FieldDescription className="nth-last-2:mt-0 [[data-variant=legend]+&]:mt-0">{description}</FieldDescription>}
      {/* Space separates the heading; fine rules separate settings from each other. */}
      {Children.toArray(children).length > 0 && <div className="@container flex min-w-0 flex-col [&>:not([data-slot=field])]:mt-4 [&>[data-slot=field]:last-child]:border-b-0">{children}</div>}
    </FieldSet>
  );
}
