import { useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Label } from "./ui/label";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { cn } from "@/lib/utils";

/** The existing filter controls share labels, sizing and a clear action across browse pages. */
export function FilterInput({ label, value, onChange, maxLength = 200, className }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number; className?: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return <div className={cn("grid min-w-0 gap-2", className)}>
    <Label htmlFor={id} className="font-normal text-muted-foreground">{label}</Label>
    <InputGroup className="has-[input:focus-visible]:bg-foreground has-[input:focus-visible]:text-background has-[input:focus-visible]:duration-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0">
      <InputGroupInput id={id} ref={input} type="search" aria-label={label} maxLength={maxLength} autoComplete="off" placeholder="Type to filter…" value={value} onChange={event => onChange(event.target.value)} className="[&::-webkit-search-cancel-button]:hidden focus-visible:placeholder:text-background/65" />
      <InputGroupAddon align="inline-end" className="p-0 text-current">
        <InputGroupButton size="icon-sm" className="touch:size-11" aria-label="Clear filter" disabled={!value} onClick={() => { onChange(""); input.current?.focus(); }}><X aria-hidden="true" /></InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>;
}

export function FilterSelect<T extends string>({ label, value, onChange, options, className }: { label: string; value: T; onChange: (value: T) => void; options: { value: T; label: string; detail?: ReactNode }[]; className?: string }) {
  const id = useId();
  return <div className={cn("grid min-w-0 gap-2", className)}>
    <Label htmlFor={id} className="font-normal text-muted-foreground">{label}</Label>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={label} className="w-full min-w-0 [&_[data-slot=select-value]]:min-w-0"><SelectValue><span className="truncate">{options.find(option => option.value === value)?.label ?? value}</span></SelectValue></SelectTrigger>
      <SelectContent className="max-w-[calc(100vw-2rem)]">{options.map(option => <SelectItem key={option.value} value={option.value} className="break-words [&>span:last-child]:min-w-0">{option.label}{option.detail != null && <span className="ml-2 tabular-nums opacity-65"> {typeof option.detail === "number" ? `(${option.detail})` : option.detail}</span>}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
}
