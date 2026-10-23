import { ChevronDown, ChevronUp } from "lucide-react";
import { SettingsSection } from "@/components/SettingsRow";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import type { useSectionRows } from "../section-rows";

/** Home's device-owned visibility and order controls: each section's Switch beside its name, its moves at the row's end. The page names it, so the list has no heading of its own. */
export function SectionRowsSettings<Id extends string>({ page, labels, layout }: {
  page: string; labels: Record<Id, string>; layout: ReturnType<typeof useSectionRows<Id>>;
}) {
  return (
    <SettingsSection>
      <ol aria-label={`${page} shelves`} className="mt-0!">
        {layout.rows.map((row, index) => <li key={row.id}>
          <Field orientation="horizontal" className="gap-3 border-b py-2">
            <Switch id={`${page.toLowerCase()}-row-${row.id}`} checked={row.shown} onCheckedChange={checked => layout.toggle(row.id, checked)} />
            <FieldLabel htmlFor={`${page.toLowerCase()}-row-${row.id}`} className="min-h-8 items-center text-body font-normal touch:min-h-11">{labels[row.id]}</FieldLabel>
            <div className="-mr-2.5 flex gap-1">
              <Button variant="ghost" size="icon" aria-label={`Move ${labels[row.id]} up`} disabled={index === 0} onClick={event => { layout.move(row.id, -1); if (index === 1) event.currentTarget.closest("li")?.querySelector<HTMLButtonElement>('[role="switch"]')?.focus(); }}><ChevronUp aria-hidden="true" /></Button>
              <Button variant="ghost" size="icon" aria-label={`Move ${labels[row.id]} down`} disabled={index === layout.rows.length - 1} onClick={event => { layout.move(row.id, 1); if (index === layout.rows.length - 2) event.currentTarget.closest("li")?.querySelector<HTMLButtonElement>('[role="switch"]')?.focus(); }}><ChevronDown aria-hidden="true" /></Button>
            </div>
          </Field>
        </li>)}
      </ol>
      <Button variant="outline" className="self-start" onClick={layout.reset}>Reset to default</Button>
    </SettingsSection>
  );
}
