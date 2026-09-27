import { Check } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deviceName } from "@/copy";
import { cn } from "@/lib/utils";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { useSessionGate } from "@/session/session-context";

type Props = { active: SettingsPage };

/** Grouped settings pages: a rail with a check on wide screens, a Select on narrow ones. */
export function SettingsNav({ active }: Props) {
  const navigate = useNavigate();
  const { identity, tvPresentation, details, state } = useSessionGate();
  const administrator = identity?.authority === "host" || identity?.authority === "administrator";
  const visible = (id: SettingsPage) => (id !== "tv-appearance" || !tvPresentation && !!details?.tvPresentation && administrator)
    && (id !== "display" || !!details?.tvPresentation)
    && (id !== "sound" && id !== "bluetooth" || details?.capabilities?.nativePlayback !== false)
    && (settingsPages[id].manage === "always" || administrator || id === "connection" && identity?.claimAvailable);
  const groups = ([
    ["Preferences", ["playback", "home", "appearance"]],
    ["Library", ["sources"]],
    [deviceName(state?.installationName ?? details?.name), ["general", "sound", "bluetooth", "display", "tv-appearance"]],
    ["Devices", ["connection"]],
    ["System", ["updates", "advanced"]],
  ] as const).map(([label, pages]) => ({ label, pages: pages.filter(visible) })).filter(group => group.pages.length);
  const current = active.startsWith("source-") ? "sources" : active;

  return <>
    <Select value={current} onValueChange={id => void navigate({ to: settingsPages[id as SettingsPage].path })}>
      <SelectTrigger aria-label="Settings page" data-page-first className="w-full md:hidden">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {groups.map(group => (
          <SelectGroup key={group.label}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.pages.map(id => <SelectItem key={id} value={id}>{settingsPages[id].label}</SelectItem>)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
    <nav aria-label="Settings pages" className="hidden min-w-0 flex-col gap-6 md:flex">
      {groups.map((group, groupIndex) => (
        <div key={group.label} className="flex flex-col">
          <p aria-hidden="true" className="mb-1 truncate px-2.5 text-xs text-muted-foreground">{group.label}</p>
          {group.pages.map((id, index) => (
            <Button key={id} data-settings-page={id} variant="ghost" asChild className="w-full justify-start font-normal">
              <Link data-page-first={groupIndex === 0 && index === 0 || undefined} aria-current={current === id ? "page" : undefined} to={settingsPages[id].path}>
                <Check aria-hidden="true" className={cn(current !== id && "invisible")} />
                {settingsPages[id].label}
              </Link>
            </Button>
          ))}
        </div>
      ))}
    </nav>
  </>;
}
