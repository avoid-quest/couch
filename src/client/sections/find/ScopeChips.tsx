import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { isTvPresentation } from "@/session/presentation";

export type Chip = {
  /** Its name, which keys it in the row and in the palette's selection (`chip:${key}`). */
  label: string;
  checked: boolean;
  count?: number;
  /** What the keyboard does with it besides a press: Tab chooses the chip the field's text names. */
  hint?: ReactNode;
  onPress: () => void;
};

/** A phone or a narrow window and the TV scroll the row sideways; a wide screen with a pointer puts what won't fit behind More. */
const scrolls = () =>
  isTvPresentation() || matchMedia("(max-width: 959px), (pointer: coarse)").matches;

/**
 * How many chips fit on the row's one line beside More, measured before paint: one fewer each pass until nothing
 * wraps. It measures again when the chips or the row's width change.
 */
function useFit(signature: string, total: number) {
  const row = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ signature, count: total, width: 0 });
  if (fit.signature !== signature) setFit({ signature, count: total, width: fit.width });
  useLayoutEffect(() => {
    const line = row.current;
    if (!line) return;
    const observer = new ResizeObserver(() => {
      const width = line.clientWidth;
      setFit((current) =>
        current.width === width ? current : { ...current, count: total, width },
      );
    });
    observer.observe(line);
    return () => observer.disconnect();
  }, [total]);
  useLayoutEffect(() => {
    const chips = [...(row.current?.children ?? [])] as HTMLElement[];
    const top = chips[0]?.offsetTop ?? 0;
    if (fit.count > 1 && chips.some((chip) => chip.offsetTop > top))
      setFit((current) => ({ ...current, count: current.count - 1 }));
  });
  return { row, fit: fit.count };
}

/**
 * The search's chip row (Design → Tokens: a capsule on the quiet fill): All, the kinds, then the sources, the chosen
 * ones checked as a ChoiceGroup's are, so focus inverts unambiguously. A press narrows at once and a chosen one's press
 * removes it. In the palette the chips are its rows, which Left and Right move along (HeaderSearch); on the results
 * page they are buttons, each with its count. A wide screen shows what fits and More; a phone and the TV scroll.
 */
export function ScopeChips({
  chips,
  query = "",
  palette = false,
  onMore,
  className,
}: {
  chips: Chip[];
  /** The results' query: chips that come as its sources answer fade in. */
  query?: string;
  /** The palette's rows rather than the page's buttons. */
  palette?: boolean;
  /** More was pressed in the palette: the first chip it showed, for the selection. */
  onMore?: (label: string) => void;
  className?: string;
}) {
  const signature = chips.map((chip) => `${chip.label}:${chip.count ?? ""}`).join("|");
  const { row, fit } = useFit(signature, chips.length);
  // What More showed first, once pressed.
  const [revealed, setRevealed] = useState<string | null>(null);
  const wraps = !scrolls();
  const shown = chips.filter((chip, index) => revealed || !wraps || index < fit || chip.checked);
  const hidden = chips.filter((chip) => !shown.includes(chip));
  // The palette's selection moves on a frame later: cmdk takes the first row when the selected one (More) goes, in a
  // render of its own after this one.
  useEffect(() => {
    if (!revealed || !onMore) return;
    const frame = requestAnimationFrame(() => onMore(revealed));
    return () => cancelAnimationFrame(frame);
  }, [revealed]);
  // On the page, More's focus goes on to the first chip it showed.
  useLayoutEffect(() => {
    if (revealed && !palette && document.activeElement === document.body)
      row.current?.querySelector<HTMLElement>(`[data-chip="${CSS.escape(revealed)}"]`)?.focus();
  }, [revealed]);
  // A row that scrolls keeps the chip just chosen in view (a scope checks a kind and a source), else the first chosen;
  // only the row scrolls, never the page.
  const checked = chips.filter((chip) => chip.checked).map((chip) => chip.label);
  const before = useRef<string[]>([]);
  useLayoutEffect(() => {
    const label = checked.find((each) => !before.current.includes(each)) ?? checked[0];
    before.current = checked;
    const line = row.current;
    const chosen = label && line?.querySelector<HTMLElement>(`[data-chip="${CSS.escape(label)}"]`);
    if (wraps || !line || !chosen) return;
    const bounds = line.getBoundingClientRect(),
      option = chosen.getBoundingClientRect();
    line.scrollLeft +=
      Math.min(0, option.left - bounds.left) || Math.max(0, option.right - bounds.right);
  }, [signature, checked.join("|"), wraps]);
  const arrived = useArrivals(
    query,
    chips.map((chip) => chip.label),
  );
  const look = "shrink-0 gap-1.5 rounded-full px-3.5 whitespace-nowrap";
  return (
    <div
      ref={row}
      role={palette ? undefined : "group"}
      aria-label={palette ? undefined : "Search in"}
      data-nav-row={palette ? undefined : true}
      className={cn(
        "flex min-w-0 gap-2",
        wraps
          ? "flex-wrap"
          : // The padding keeps a focused chip clear of the clip.
            "-my-1 flex-nowrap overflow-x-auto py-1 [scrollbar-width:none]",
        className,
      )}
    >
      {shown.map((chip) =>
        palette ? (
          <CommandItem
            key={chip.label}
            value={`chip:${chip.label}`}
            data-chip={chip.label}
            data-checked={chip.checked}
            onSelect={chip.onPress}
            className={cn(
              look,
              "min-h-control! bg-secondary text-sm! touch:min-h-11! tv:min-h-12! tv:text-base! [&>svg]:order-first [&>svg]:-ml-1",
            )}
          >
            {chip.label}
            {chip.hint}
          </CommandItem>
        ) : (
          <Button
            key={chip.label}
            variant="secondary"
            aria-pressed={chip.checked}
            data-chip={chip.label}
            onClick={chip.onPress}
            className={cn(
              look,
              arrived(chip.label) &&
                "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200",
            )}
          >
            {chip.checked && <Check aria-hidden="true" className="-ml-1" />}
            {chip.label}
            {chip.count != null && (
              <span className="font-normal text-muted-foreground tabular-nums">{chip.count}</span>
            )}
          </Button>
        ),
      )}
      {wraps &&
        hidden.length > 0 &&
        (palette ? (
          <CommandItem
            value="chip:more"
            onSelect={() => setRevealed(hidden[0]!.label)}
            className={cn(look, "min-h-control! text-sm! text-muted-foreground")}
          >
            More
          </CommandItem>
        ) : (
          <Button
            variant="ghost"
            onClick={() => setRevealed(hidden[0]!.label)}
            className={cn(look, "text-muted-foreground")}
          >
            More
          </Button>
        ))}
    </div>
  );
}

/** Which chips were already there when the query's results first showed, so only later arrivals fade in. */
function useArrivals(key: string, labels: string[]) {
  const first = useRef<{ key: string; labels: Set<string> } | null>(null);
  if (first.current?.key !== key) first.current = { key, labels: new Set(labels) };
  return (label: string) => !first.current!.labels.has(label);
}
