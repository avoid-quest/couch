import type { ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { SettingsSection } from "@/components/SettingsRow";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { useSectionRows } from "../section-rows";

/**
 * Edit Home: one line per section, in Home's order, with what it holds under its name, its moves and its Switch at the
 * line's end. The page names it, so the list has no heading of its own. A moved line's button that reaches the end of
 * the list hands its focus to the line's Switch.
 */
export function SectionRowsSettings<Id extends string>({
  page,
  rows,
  layout,
  actions,
}: {
  page: string;
  rows: Record<Id, { label: string; note?: string }>;
  layout: ReturnType<typeof useSectionRows<Id>>;
  /** A line's own verbs before its moves (Home's followed sections: Rename, Remove). */
  actions?: (id: Id) => ReactNode;
}) {
  const toSwitch = (button: HTMLElement) =>
    button.closest("li")?.querySelector<HTMLButtonElement>('[role="switch"]')?.focus();
  return (
    <SettingsSection>
      <ol aria-label={`${page} sections`} className="mt-0!">
        {layout.rows.map((row, index) => {
          const { label, note } = rows[row.id];
          const id = `${page.toLowerCase()}-row-${row.id}`;
          return (
            <li key={row.id}>
              <Field orientation="horizontal" className="items-center gap-4 border-b py-3">
                <FieldContent className="min-w-0 flex-1 gap-0.5">
                  <FieldLabel
                    htmlFor={id}
                    className={cn("text-body font-medium", !row.shown && "text-muted-foreground")}
                  >
                    {label}
                  </FieldLabel>
                  {note && <FieldDescription className="text-meta">{note}</FieldDescription>}
                </FieldContent>
                <div className="flex shrink-0 items-center gap-1">
                  {actions?.(row.id)}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${label} up`}
                    title="Move up"
                    disabled={index === 0}
                    onClick={(event) => {
                      layout.move(row.id, -1);
                      if (index === 1) toSwitch(event.currentTarget);
                    }}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${label} down`}
                    title="Move down"
                    disabled={index === layout.rows.length - 1}
                    onClick={(event) => {
                      layout.move(row.id, 1);
                      if (index === layout.rows.length - 2) toSwitch(event.currentTarget);
                    }}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Switch
                    id={id}
                    className="ml-2"
                    checked={row.shown}
                    onCheckedChange={(checked) => layout.toggle(row.id, checked)}
                  />
                </div>
              </Field>
            </li>
          );
        })}
      </ol>
      <Button variant="outline" className="self-start" onClick={layout.reset}>
        Reset to default
      </Button>
    </SettingsSection>
  );
}
