import { Fragment } from "react";
import { Check } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { settingsPages, type SettingsPage } from "../../../shared/settings-pages";
import { useSessionGate } from "@/session/session-context";
import { focusPageControl } from "@/navigation";
import { useSettingsPages, useSettingsScope } from "./settings-scope";

type Props = { active: SettingsPage };

/** Pages under their two owners, this device then the shared Couch: a rail with a check on wide screens, a Select on narrow ones. */
export function SettingsNav({ active }: Props) {
  const navigate = useNavigate();
  const { tvPresentation } = useSessionGate();
  const scope = useSettingsScope();
  const pages = useSettingsPages();
  const scopes = [
    { id: "device", title: "This device", detail: scope.device },
    { id: "couch", title: scope.couch, detail: scope.role ? `Shared · ${scope.role}` : "Shared" },
  ].map(item => ({ ...item, pages: pages.filter(id => settingsPages[id].scope === item.id) }));
  const group = (id: SettingsPage) => { const page = settingsPages[id]; return "group" in page ? page.group : null; };
  const groupLabel = (name: string) => name === "Hardware" ? `${scope.couch}'s hardware` : name;
  const current = active.startsWith("source-") ? "sources" : active;

  return <>
    <Select value={current} onValueChange={id => void navigate({ to: settingsPages[id as SettingsPage].path })}>
      <SelectTrigger aria-label="Settings page" data-page-first className="w-full md:hidden">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {scopes.map(item => (
          <SelectGroup key={item.id}>
            <SelectLabel>{item.title} · {item.detail}</SelectLabel>
            {item.pages.map(id => <SelectItem key={id} value={id}>{settingsPages[id].label}</SelectItem>)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
    <nav aria-label="Settings pages" className="hidden min-w-0 flex-col gap-8 md:flex">
      {scopes.map(item => (
        <div key={item.id} role="group" aria-label={`${item.title} · ${item.detail}`} data-settings-scope={item.id} className="flex flex-col">
          <p aria-hidden="true" className="truncate px-2.5 text-base font-medium">{item.title}</p>
          {/* The role can be longer than the rail is wide, so it wraps. */}
          <p aria-hidden="true" className="mb-1 px-2.5 text-xs text-muted-foreground">{item.detail}</p>
          {item.pages.map((id, index) => {
            const name = group(id), starts = index > 0 && name !== group(item.pages[index - 1]!);
            return <Fragment key={id}>
              {starts && (name ? <p aria-hidden="true" className="mt-3 mb-1 truncate px-2.5 text-xs text-muted-foreground">{groupLabel(name)}</p> : <div aria-hidden="true" className="mt-3" />)}
              <Button data-settings-page={id} variant="ghost" asChild className="w-full justify-start font-normal">
                <Link data-page-first={current === id || undefined} aria-current={current === id ? "page" : undefined} to={settingsPages[id].path} onClick={event => {
                  if (!tvPresentation || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  void navigate({ to: settingsPages[id].path }).then(() => {
                    const content = document.querySelector<HTMLElement>("[data-settings-content]");
                    if (content) focusPageControl(content);
                  });
                }}>
                  <Check aria-hidden="true" className={cn(current !== id && "invisible")} />
                  {settingsPages[id].label}
                </Link>
              </Button>
            </Fragment>;
          })}
        </div>
      ))}
    </nav>
  </>;
}
