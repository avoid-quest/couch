import { Search, X } from "lucide-react";
import type { Ref } from "react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

// The one search field every page shares: same markup, same look, same
// clear affordance. Page-specific behavior arrives through the callbacks.
export function SearchBar({ id, value, onValueChange, onSubmit, onClear, ariaLabel = "Search or paste a link", placeholder = ariaLabel, className, inputRef }: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onClear?: () => void;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return <form role="search" aria-label={ariaLabel} className={className} onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    <InputGroup className="rounded-2xl border bg-card py-1 shadow-[0_1px_0_rgb(0_0_0/0.2)] focus-within:border-primary">
      <InputGroupAddon align="inline-start"><Search aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" /></InputGroupAddon>
      <InputGroupInput ref={inputRef} id={id} aria-label={ariaLabel} type="search" maxLength={4096} className="[&::-webkit-search-cancel-button]:hidden" value={value} onChange={event => onValueChange(event.target.value)} placeholder={placeholder} />
      {onClear && value ? <InputGroupAddon align="inline-end"><Button variant="ghost" size="icon" type="button" aria-label="Clear search" onClick={onClear}><X aria-hidden="true" /></Button></InputGroupAddon> : null}
    </InputGroup>
  </form>;
}
