import { Check } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { useShell } from "@/sections/shell/AppShell";

type Props = { active: SettingsPage };

export function SettingsNav({ active }: Props) {
  const navigate = useNavigate();
  const { identity, tvPresentation, details, state } = useShell();
  const sourcePage = active.startsWith("source-");
  const administrator = identity?.authority === "host" || identity?.authority === "administrator";
  const visible = (id: string) => (id !== "tv-appearance" || !tvPresentation && !!details?.tvPresentation && administrator)
    && (id !== "display" || !!details?.tvPresentation)
    && (settingsPages[id as SettingsPage].manage === "always" || administrator || id === "connection" && identity?.claimAvailable);
  const groups = [
    { label: "Playback", pages: ["playback", "appearance"] },
    { label: "Library", pages: ["sources"] },
    { label: state?.installationName ?? details?.name ?? "This device", pages: ["general", "sound", "display", "tv-appearance"] },
    { label: "Connections", pages: ["connection", "bluetooth"] },
    { label: "System", pages: ["updates", "advanced"] },
  ].map(group => ({
    ...group,
    pages: group.pages.filter(visible).map(id => [id, settingsPages[id as SettingsPage]] as const),
  })).filter(group => group.pages.length);

  const current = sourcePage ? "sources" : active;
  return <>
    <Select value={current} onValueChange={id => { const page = settingsPages[id as SettingsPage]; if (page) void navigate({ to: page.path }); }}>
      <SelectTrigger aria-label="Settings page" className="settings-nav-select mb-6 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {groups.map(group => (
          <SelectGroup key={group.label}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.pages.map(([id, page]) => <SelectItem key={id} value={id}>{page.label}</SelectItem>)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
    <nav aria-label="Settings pages" className="settings-nav-rail settings-page-nav min-w-0 self-start">
      {groups.map(group => (
        <div key={group.label} className="mb-5">
          <p aria-hidden="true" className="mb-1 px-3 text-xs font-normal text-muted-foreground">{group.label}</p>
          {group.pages.map(([id, page]) => (
            <Button key={id} data-settings-page={id} variant="ghost" asChild className="h-auto min-h-11 w-full justify-start gap-3 rounded-none px-3 py-2.5 text-left font-normal whitespace-normal">
              <Link aria-current={active === id || id === "sources" && sourcePage ? "page" : undefined} to={page.path}>
                <Check aria-hidden="true" className={`size-4 shrink-0 ${active === id || id === "sources" && sourcePage ? "" : "invisible"}`} />
                <span>{id === "connection" ? "Remotes" : page.label}</span>
              </Link>
            </Button>
          ))}
        </div>
      ))}
    </nav>
  </>;
}
