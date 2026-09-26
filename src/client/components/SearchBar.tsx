import { Search, X } from "lucide-react";
import { useRef, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

// The one search field every page shares: display type on a hairline, with a
// clear button. Page-specific behavior arrives through the callbacks.
export function SearchBar({ id, value, onValueChange, onSubmit, onClear, onCompositionChange, ariaLabel = "Search or paste a link", placeholder = ariaLabel, className, inputRef, pageFirst = false }: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onClear?: () => void;
  onCompositionChange?: (composing: boolean) => void;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  pageFirst?: boolean;
}) {
  const composing = useRef(false);
  return <form role="search" aria-label={ariaLabel} className={className} onSubmit={event => { event.preventDefault(); if (!composing.current) onSubmit(); }}>
    <InputGroup className="h-auto rounded-none border-0 border-b bg-transparent dark:bg-transparent has-[[data-slot=input-group-control]:focus-visible]:border-foreground has-[[data-slot=input-group-control]:focus-visible]:ring-0">
      <InputGroupAddon align="inline-start" className="pl-0"><Search aria-hidden="true" className="size-6 text-muted-foreground" /></InputGroupAddon>
      <InputGroupInput ref={inputRef} id={id} data-page-first={pageFirst || undefined} aria-label={ariaLabel} type="search" maxLength={4096} className="h-auto touch:h-auto py-3 text-3xl font-semibold tracking-tight md:text-3xl dark:bg-transparent [&::-webkit-search-cancel-button]:hidden" value={value} onCompositionStart={() => { composing.current = true; onCompositionChange?.(true); }} onCompositionEnd={event => { composing.current = false; onValueChange(event.currentTarget.value); onCompositionChange?.(false); }} onKeyDown={event => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229 || composing.current)) event.preventDefault(); }} onChange={event => onValueChange(event.target.value)} placeholder={placeholder} />
      {onClear && value ? <InputGroupAddon align="inline-end" className="pr-0"><Button variant="ghost" size="icon" type="button" aria-label="Clear search" onClick={onClear}><X aria-hidden="true" /></Button></InputGroupAddon> : null}
    </InputGroup>
  </form>;
}
