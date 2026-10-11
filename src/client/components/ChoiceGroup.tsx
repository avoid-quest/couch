import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type Choice<T extends string> = { value: T; label: ReactNode; count?: ReactNode; disabled?: boolean };

/**
 * Inline choices where the selected option carries a check (Clock). Focus
 * inversion stays unambiguous because selection never fills the background.
 */
export function ChoiceGroup<T extends string>({ label, value, onValueChange, options, orientation = "horizontal", disabled, className }: {
  label: string; value: T; onValueChange: (value: T) => void; options: Choice<T>[]; orientation?: "horizontal" | "vertical"; disabled?: boolean; className?: string;
}) {
  return (
    <ToggleGroup type="single" aria-label={label} orientation={orientation} spacing={0} value={value} disabled={disabled}
      onValueChange={next => { if (next) onValueChange(next as T); }}
      className={cn("flex-wrap", orientation === "vertical" && "w-full flex-col items-stretch", className)}>
      {options.map(option => (
        <ToggleGroupItem key={option.value} value={option.value} disabled={option.disabled} className="justify-start gap-2 font-normal data-[state=on]:bg-transparent">
          <Check aria-hidden="true" className={option.value === value ? "" : "invisible"} />
          {option.label}
          {option.count != null && <span className="ml-auto pl-3 text-muted-foreground">{option.count}</span>}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
