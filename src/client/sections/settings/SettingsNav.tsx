import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { useSessionGate } from "@/session/session-context";
import { focusPageControl } from "@/navigation";
import { useSettingsPages } from "./settings-scope";

type Props = { active: SettingsPage };

/** Settings' pages: a rail with the current one marked on wide screens, a Select on narrow ones. */
export function SettingsNav({ active }: Props) {
  const navigate = useNavigate();
  const { tvPresentation } = useSessionGate();
  const pages = useSettingsPages();
  const current = active.startsWith("source-") ? "sources" : active;

  return <>
    <Select value={current} onValueChange={id => void navigate({ to: settingsPages[id as SettingsPage].path })}>
      <SelectTrigger aria-label="Settings page" data-page-first className="w-full md:hidden"><SelectValue>{settingsPages[current].label}</SelectValue></SelectTrigger>
      <SelectContent>{pages.map(id => <SelectItem key={id} value={id}>{settingsPages[id].label}</SelectItem>)}</SelectContent>
    </Select>
    <nav data-nav-rail aria-label="Settings pages" className="hidden min-w-0 flex-col md:flex">
      {pages.map(id => (
        <Button key={id} data-settings-page={id} variant="ghost" asChild className="h-10 w-full justify-start rounded-none border-y-0 border-r-0 border-l-2 border-transparent pl-3 font-normal text-muted-foreground aria-[current=page]:border-foreground aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-foreground">
          <Link data-page-first={current === id || undefined} aria-current={current === id ? "page" : undefined} to={settingsPages[id].path} onClick={event => {
            if (!tvPresentation || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            void navigate({ to: settingsPages[id].path }).then(() => {
              const content = document.querySelector<HTMLElement>("[data-settings-content]");
              if (content) focusPageControl(content);
            });
          }}>
            {settingsPages[id].label}
          </Link>
        </Button>
      ))}
    </nav>
  </>;
}
