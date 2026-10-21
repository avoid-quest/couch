import { useRef, type ComponentProps, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { cn } from "@/lib/utils";

type Option<T extends string> = { value: T; label: string; detail?: ReactNode };

/** A list's filters as one row above it, choices first and the text field last; it wraps on phones. */
export function FilterBar({ label, ...props }: { label: string } & ComponentProps<"div">) {
  return <div role="group" aria-label={label} className="flex flex-wrap items-center gap-x-4 gap-y-2" {...props} />;
}

/**
 * A few choices, underlined as the header's sections are, so selection never fills what focus inverts. On a phone
 * they stay one line that scrolls sideways.
 */
export function FilterChoice<T extends string>({ label, value, onChange, options, className }: { label: string; value: T; onChange: (value: T) => void; options: Option<T>[]; className?: string }) {
  return <ToggleGroup type="single" aria-label={label} spacing={1} value={value} onValueChange={next => { if (next) onChange(next as T); }} className={cn("max-w-full flex-wrap max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:[scrollbar-width:none]", className)}>
    {options.map(option => <ToggleGroupItem key={option.value} value={option.value} className="shrink-0 rounded-none border-b-2 border-transparent px-2 font-normal text-muted-foreground data-[state=on]:border-foreground data-[state=on]:bg-transparent data-[state=on]:text-foreground">{option.label}</ToggleGroupItem>)}
  </ToggleGroup>;
}

/** Many choices: a Select whose value names itself, so it needs no label above it. */
export function FilterSelect<T extends string>({ label, value, onChange, options, className }: { label: string; value: T; onChange: (value: T) => void; options: Option<T>[]; className?: string }) {
  return <Select value={value} onValueChange={onChange}>
    <SelectTrigger aria-label={label} className={cn("max-w-full min-w-0 sm:max-w-64 [&_[data-slot=select-value]]:min-w-0", className)}><SelectValue><span className="truncate">{options.find(option => option.value === value)?.label ?? value}</span></SelectValue></SelectTrigger>
    <SelectContent className="max-w-[calc(100vw-2rem)]">{options.map(option => <SelectItem key={option.value} value={option.value} className="break-words [&>span:last-child]:min-w-0">{option.label}{option.detail != null && <span className="ml-2 tabular-nums opacity-65"> {typeof option.detail === "number" ? `(${option.detail})` : option.detail}</span>}</SelectItem>)}</SelectContent>
  </Select>;
}

/** The text filter: a search glyph, "Filter", and a clear button only while there is text to clear. */
export function FilterInput({ label, value, onChange, maxLength = 200, className }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return <InputGroup className={cn("w-auto min-w-48 flex-1 sm:max-w-72", className, "has-[input:focus-visible]:bg-foreground has-[input:focus-visible]:text-background has-[input:focus-visible]:duration-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0")}>
    <InputGroupAddon className="group-has-[input:focus-visible]/input-group:text-background/65"><Search aria-hidden="true" /></InputGroupAddon>
    <InputGroupInput ref={input} type="search" aria-label={label} maxLength={maxLength} autoComplete="off" placeholder="Filter" value={value} onChange={event => onChange(event.target.value)} className="[&::-webkit-search-cancel-button]:hidden focus-visible:placeholder:text-background/65" />
    {value && <InputGroupAddon align="inline-end" className="p-0 text-current">
      <InputGroupButton size="icon-sm" className="touch:size-11" aria-label="Clear filter" onClick={() => { onChange(""); input.current?.focus(); }}><X aria-hidden="true" /></InputGroupButton>
    </InputGroupAddon>}
  </InputGroup>;
}
