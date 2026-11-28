import { Children, type ComponentProps, type ReactNode } from "react";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * A label with its one-line description on the left and its control at the right, divided from the next row. A control too
 * wide to sit beside the label wraps under it.
 */
export function SettingsRow({
  label,
  htmlFor,
  description,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  label: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Field
      className={cn(
        "flex-row flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border/60 py-4 *:w-auto",
        className,
      )}
      {...props}
    >
      <FieldContent className="min-w-0 basis-60 gap-1">
        {htmlFor ? (
          <FieldLabel htmlFor={htmlFor} className={cn("items-center", labelLine)}>
            {label}
          </FieldLabel>
        ) : (
          <FieldTitle className={cn("min-w-0 break-words", labelLine)}>{label}</FieldTitle>
        )}
        {description && (
          <FieldDescription className="max-w-[46ch] text-pretty break-words">
            {description}
          </FieldDescription>
        )}
      </FieldContent>
      {Children.toArray(children).length > 0 && (
        <div className="flex min-h-8 max-w-full min-w-0 flex-wrap items-center gap-2">
          {children}
        </div>
      )}
    </Field>
  );
}

const labelLine = "text-body font-medium";

/**
 * A titled group of settings. Rows sit flush and divided; anything else
 * (status lines, alerts, short text) gets breathing room above it.
 */
export function SettingsSection({
  title,
  description,
  children,
  className,
  ...props
}: Omit<ComponentProps<"fieldset">, "title" | "children"> & {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <FieldSet className={cn("min-w-0 gap-2", className)} {...props}>
      {title && (
        <FieldLegend className="mb-0 font-heading data-[variant=legend]:text-heading font-semibold">
          {title}
        </FieldLegend>
      )}
      {description && (
        <FieldDescription className="nth-last-2:mt-0 [[data-variant=legend]+&]:mt-0">
          {description}
        </FieldDescription>
      )}
      {/* Space separates the heading; fine rules separate settings from each other. */}
      {Children.toArray(children).length > 0 && (
        <div className="@container flex min-w-0 flex-col [&>:not([data-slot=field])]:mt-4 [&>[data-slot=field]:last-child]:border-b-0">
          {children}
        </div>
      )}
    </FieldSet>
  );
}
