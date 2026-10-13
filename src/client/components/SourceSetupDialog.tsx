import { useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ADMIN_ONLY } from "@/copy";
import { SettingsSources } from "@/sections/settings/SettingsSources";
import type { SourceKind, SourceSettingsProps } from "@/components/sourceTypes";

const sources = { "device-inputs": "This device", iptv: "Live TV", radio: "Radio playlists", "streaming-community": "StreamingCommunity" } as const;
export type SourceSetupKind = keyof typeof sources;
type Props = SourceSettingsProps & { localOnly?: boolean; open: boolean; onOpenChange: (open: boolean) => void; source?: SourceKind };

export function SourceSetupDialog({ open, onOpenChange, localOnly, source: initialSource, ...props }: Props) {
  const trigger = useRef<HTMLElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}
        data-tv-local-only={localOnly || undefined}
        onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); }}
        onOpenAutoFocus={() => { trigger.current = document.activeElement as HTMLElement; }}
      >
        <DialogHeader><DialogTitle>Add source</DialogTitle></DialogHeader>
        <Tabs defaultValue={initialSource ?? (props.canManage ? "iptv" : "device-inputs")} key={initialSource ?? "default"}>
          <TabsList aria-label="Source type" className="grid w-full grid-cols-2 group-data-horizontal/tabs:h-auto">
            {Object.entries(sources).map(([value, label]) => <TabsTrigger className="h-auto min-h-9 whitespace-normal" key={value} value={value}>{label}</TabsTrigger>)}
          </TabsList>
          {Object.keys(sources).map(source => (
            <TabsContent key={source} className="pt-4" value={source}>
              {props.canManage || source === "device-inputs" ? <SettingsSources {...props} source={source as SourceKind} onAdded={() => onOpenChange(false)} /> : <p className="text-sm text-muted-foreground">{ADMIN_ONLY}</p>}
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
