import { useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

// One line that never wraps; on a phone it scrolls sideways. The padding keeps the focus outline clear of the clip, and
// the margin pulls the first option's text onto the page's edge.
const line = "-my-1 flex flex-nowrap items-center overflow-x-auto p-1 [scrollbar-width:none]";
// An option that arrives while the query's sources answer fades in where the fixed order puts it.
const arrive = "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200";

/** Which values were already there when the query's results first showed, so only later arrivals fade in. */
function useArrivals(key: string, values: string[]) {
  const first = useRef<{ key: string; values: Set<string> } | null>(null);
  if (first.current?.key !== key) first.current = { key, values: new Set(values) };
  return (value: string) => !first.current!.values.has(value);
}

/** Keeps the chosen option on screen when its line scrolls sideways, from when it arrives and as others arrive before it. */
function useChosenInView(value: string, shown: boolean, options: number) {
  const row = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const line = row.current, chosen = line?.querySelector<HTMLElement>('[aria-checked="true"], [aria-pressed="true"]');
    // Only the line scrolls, never the page.
    if (!shown || !line || !chosen) return;
    const bounds = line.getBoundingClientRect(), option = chosen.getBoundingClientRect();
    line.scrollLeft += Math.min(0, option.left - bounds.left) || Math.max(0, option.right - bounds.right);
  }, [value, shown, options]);
  return row;
}

/**
 * The kinds the query found, in the shelves' order, each with its count: the chosen one in white, the rest muted. The
 * header's field names the chosen scope, so this line stays the size of the sources under it rather than a heading.
 * Only kinds with hits are offered, so every choice has results.
 */
export function SearchKinds<T extends string>({ query, value, options, onChange }: { query: string; value: T; options: { value: T; label: string; count: number }[]; onChange: (value: T) => void }) {
  const arrived = useArrivals(query, options.map(option => option.value));
  const row = useChosenInView(value, options.some(option => option.value === value), options.length);
  return <ToggleGroup ref={row} data-nav-row type="single" aria-label="Kind" spacing={1} value={value} onValueChange={next => { if (next) onChange(next as T); }} className={cn(line, "-mx-3 w-auto rounded-none")}>
    {options.map(option => <ToggleGroupItem key={option.value} value={option.value} className={cn("h-8 shrink-0 gap-1.5 px-2 font-medium text-muted-foreground touch:h-11 data-[state=on]:bg-transparent data-[state=on]:text-foreground", arrived(option.value) && arrive)}>
      {option.label}{option.count > 0 && <span className="font-normal text-muted-foreground tabular-nums"> {option.count}</span>}
    </ToggleGroupItem>)}
  </ToggleGroup>;
}

/**
 * The sources that have hits of the chosen kind, smaller and lighter under the kinds, each with its count. One is
 * pressed to narrow to it and pressed again to see every source; none pressed is every source.
 */
export function SearchSources({ query, value, options, onChange }: { query: string; value: string; options: { value: string; count: number }[]; onChange: (value: string) => void }) {
  const arrived = useArrivals(query, options.map(option => option.value));
  const row = useChosenInView(value, options.some(option => option.value === value), options.length);
  return <div ref={row} role="group" aria-label="Source" data-nav-row className={cn(line, "-mx-3 gap-x-1")}>
    {options.map(option => {
      const pressed = option.value === value;
      return <Button key={option.value} variant="ghost" aria-pressed={pressed} onClick={() => onChange(pressed ? "All" : option.value)}
        className={cn("shrink-0 gap-1.5 px-2 font-normal text-muted-foreground aria-pressed:text-foreground", arrived(option.value) && arrive)}>
        {option.value}{option.count > 0 && <span className="text-muted-foreground tabular-nums"> {option.count}</span>}{pressed && <X aria-hidden="true" className="-mr-0.5 size-3.5" />}
      </Button>;
    })}
  </div>;
}
