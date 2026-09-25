import { Check } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { interfaceSizes, type InterfaceSize } from "../../../../shared/appearance";

export function InterfaceSizeChoices({ label, value, disabled, onChange }: {
  label: string; value: InterfaceSize; disabled?: boolean; onChange: (value: InterfaceSize) => void;
}) {
  return (
    <ToggleGroup type="single" aria-label={label} value={String(value)} disabled={disabled} onValueChange={next => { if (next) onChange(Number(next) as InterfaceSize); }} className="flex-wrap justify-start">
      {interfaceSizes.map(size => (
        <ToggleGroupItem key={size.value} value={String(size.value)} className="min-h-11 gap-1.5" variant="outline">
          <Check aria-hidden="true" className={`size-4 ${value === size.value ? "" : "invisible"}`} />{size.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
