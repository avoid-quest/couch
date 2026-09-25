import { Search, X } from "lucide-react";
import type { Ref } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { useOptionalShell } from "@/sections/shell/shell-context";

// The one search field every page shares: same markup, same look, same
// clear affordance. Page-specific behavior arrives through the callbacks.
export function SearchBar({ id, value, onValueChange, onSubmit, onClear, ariaLabel = "Search or paste a link", placeholder = ariaLabel, className, inputRef, pageFirst = false }: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onClear?: () => void;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  pageFirst?: boolean;
}) {
  const { tvPresentation } = useOptionalShell() ?? { tvPresentation: false };
  return <form role="search" aria-label={ariaLabel} className={className} onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    <InputGroup className={cn("rounded-none border-x-0 border-t-0 border-b border-border bg-transparent shadow-none focus-within:border-primary", tvPresentation ? "h-16 px-5 text-2xl" : "py-1 text-lg")}>
      <InputGroupAddon align="inline-start"><Search aria-hidden="true" className="size-[1.25em] shrink-0 text-muted-foreground" /></InputGroupAddon>
      <InputGroupInput ref={inputRef} id={id} data-page-first={pageFirst || undefined} aria-label={ariaLabel} type="search" maxLength={4096} className="[&::-webkit-search-cancel-button]:hidden" value={value} onChange={event => onValueChange(event.target.value)} placeholder={placeholder} />
      {onClear && value ? <InputGroupAddon align="inline-end"><Button variant="ghost" size="icon" type="button" aria-label="Clear search" onClick={onClear}><X aria-hidden="true" /></Button></InputGroupAddon> : null}
    </InputGroup>
  </form>;
}
