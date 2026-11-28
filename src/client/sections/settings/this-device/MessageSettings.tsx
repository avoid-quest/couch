import { ChoiceGroup } from "@/components/ChoiceGroup";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Switch } from "@/components/ui/switch";
import { confirmations, messagePlace } from "@/toasts";

const places = [
  { value: "bottom", label: "Bottom" },
  { value: "top", label: "Top" },
] as const;

/** Where this device shows messages, and whether it confirms routine actions. Undo and problems always show. */
export function MessageSettings() {
  const place = messagePlace.use();
  const confirming = confirmations.use();
  return (
    <SettingsSection title="Messages">
      <SettingsRow label="Where messages appear">
        <ChoiceGroup
          label="Where messages appear"
          variant="segmented"
          value={place}
          options={[...places]}
          onValueChange={messagePlace.save}
        />
      </SettingsRow>
      <SettingsRow
        label="Confirmations"
        htmlFor="message-confirmations"
        description="“Queued”, “Playing on” and similar. Undo and problems always show."
      >
        <Switch
          id="message-confirmations"
          checked={confirming}
          onCheckedChange={confirmations.save}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
