import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { homeRowLabels, useHomeRows } from "@/sections/home/home-rows";
import { SettingsLayout } from "../SettingsLayout";

export function SettingsHome() {
  const layout = useHomeRows();
  return <SettingsLayout section="home">
    <SettingsSection description="Choose the rows and their order on this device. Empty rows stay hidden.">
      <ol aria-label="Home rows">
        {layout.rows.map((row, index) => <li key={row.id}>
          <SettingsRow label={homeRowLabels[row.id]} htmlFor={`home-row-${row.id}`}>
            <Switch id={`home-row-${row.id}`} checked={row.shown} onCheckedChange={checked => layout.toggle(row.id, checked)} />
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" size="icon" aria-label={`Move ${homeRowLabels[row.id]} up`} disabled={index === 0} onClick={() => layout.move(row.id, -1)}><ChevronUp aria-hidden="true" /></Button>
              <Button variant="ghost" size="icon" aria-label={`Move ${homeRowLabels[row.id]} down`} disabled={index === layout.rows.length - 1} onClick={() => layout.move(row.id, 1)}><ChevronDown aria-hidden="true" /></Button>
            </div>
          </SettingsRow>
        </li>)}
      </ol>
      <Button variant="ghost" className="self-start -ml-2.5" onClick={layout.reset}>Reset to default</Button>
    </SettingsSection>
  </SettingsLayout>;
}
