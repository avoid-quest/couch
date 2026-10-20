import { ChevronDown, ChevronUp } from "lucide-react";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { useSectionRows } from "../section-rows";

/** Home and Discover's device-owned visibility and order controls. */
export function SectionRowsSettings<Id extends string>({ page, description, labels, layout }: {
  page: string; description: string; labels: Record<Id, string>; layout: ReturnType<typeof useSectionRows<Id>>;
}) {
  return (
    <SettingsSection description={description}>
      <ol aria-label={`${page} shelves`}>
        {layout.rows.map((row, index) => <li key={row.id}>
          <SettingsRow label={labels[row.id]} className="[&_label]:touch:min-h-11 [&_label]:items-center" htmlFor={`${page.toLowerCase()}-row-${row.id}`}>
            <Switch id={`${page.toLowerCase()}-row-${row.id}`} checked={row.shown} onCheckedChange={checked => layout.toggle(row.id, checked)} />
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" size="icon" aria-label={`Move ${labels[row.id]} up`} disabled={index === 0} onClick={event => { layout.move(row.id, -1); if (index === 1) event.currentTarget.closest("li")?.querySelector<HTMLButtonElement>('[role="switch"]')?.focus(); }}><ChevronUp aria-hidden="true" /></Button>
              <Button variant="ghost" size="icon" aria-label={`Move ${labels[row.id]} down`} disabled={index === layout.rows.length - 1} onClick={event => { layout.move(row.id, 1); if (index === layout.rows.length - 2) event.currentTarget.closest("li")?.querySelector<HTMLButtonElement>('[role="switch"]')?.focus(); }}><ChevronDown aria-hidden="true" /></Button>
            </div>
          </SettingsRow>
        </li>)}
      </ol>
      <Button variant="ghost" className="self-start -ml-2.5" onClick={layout.reset}>Reset to default</Button>
    </SettingsSection>
  );
}
