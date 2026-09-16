import { Button } from "@/components/ui/button";
import { interfaceSizes, type InterfaceSize } from "../../../../shared/appearance";

export function InterfaceSizeChoices({ label, value, disabled, onChange }: {
  label: string; value: InterfaceSize; disabled?: boolean; onChange: (value: InterfaceSize) => void;
}) {
  return (
    <div role="group" aria-label={label} className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(5.5rem,1fr))]">
      {interfaceSizes.map(size => (
        <Button key={size.value} className="min-h-11" variant={value === size.value ? "secondary" : "outline"}
          aria-pressed={value === size.value} disabled={disabled} onClick={() => onChange(size.value)}>{size.label}</Button>
      ))}
    </div>
  );
}
