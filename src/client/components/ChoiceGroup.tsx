import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type Choice<T extends string> = {
  value: T;
  label: ReactNode;
  count?: ReactNode;
  disabled?: boolean;
};

/**
 * Inline choices where the selected option carries a check (Clock). Focus
 * inversion stays unambiguous because selection never fills the background.
 * `segmented` (a setting's row) sets the choices on one track and fills the
 * selected one; its check stays, so a focused choice still reads apart from the
 * selected one.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  onValueChange,
  options,
  orientation = "horizontal",
  variant = "checks",
  disabled,
  className,
}: {
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  options: Choice<T>[];
  orientation?: "horizontal" | "vertical";
  variant?: "checks" | "segmented";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      aria-label={label}
      orientation={orientation}
      spacing={0}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      className={cn(
        "flex-wrap",
        orientation === "vertical" && "w-full flex-col items-stretch",
        variant === "segmented" && "gap-0 rounded-[1.25rem] bg-secondary p-0.5",
        className,
      )}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={
            variant === "segmented"
              ? "h-8 gap-1.5 font-medium group-data-[spacing=0]/toggle-group:px-3 text-muted-foreground touch:h-10 data-[state=on]:bg-foreground data-[state=on]:text-background"
              : "justify-start gap-2 font-normal data-[state=on]:bg-transparent"
          }
        >
          {(variant === "checks" || option.value === value) && (
            <Check aria-hidden="true" className={option.value === value ? "" : "invisible"} />
          )}
          {option.label}
          {option.count != null && (
            <span className="ml-auto pl-3 text-muted-foreground">{option.count}</span>
          )}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
