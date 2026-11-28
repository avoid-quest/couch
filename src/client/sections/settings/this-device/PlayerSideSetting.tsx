import { ChoiceGroup } from "@/components/ChoiceGroup";
import { SettingsRow } from "@/components/SettingsRow";
import { usePlayerSide, type PlayerSide } from "@/sections/shell/player-side";

const sides: { value: PlayerSide; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

/** Which side of the screen Now playing stands at, on this device only. */
export function PlayerSideSetting() {
  const { side, save } = usePlayerSide();
  return (
    <SettingsRow label="Player side" description="Where Now playing stands beside the page.">
      <ChoiceGroup
        label="Player side"
        variant="segmented"
        value={side}
        options={sides}
        onValueChange={save}
      />
    </SettingsRow>
  );
}
