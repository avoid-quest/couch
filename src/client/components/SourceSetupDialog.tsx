import { useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ADMIN_ONLY } from "@/copy";
import { SettingsSources } from "@/sections/settings/SettingsSources";
import type { SourceKind, SourceSettingsProps } from "@/components/sourceTypes";

const sources = { iptv: "Live TV", radio: "Radio playlists", "streaming-community": "StreamingCommunity" } as const;
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
        {props.canManage ? (
          <Tabs defaultValue={initialSource ?? "iptv"} key={initialSource ?? "iptv"}>
            <TabsList aria-label="Source type" className="h-auto w-full flex-wrap justify-start">
              {Object.entries(sources).map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}
            </TabsList>
            {Object.keys(sources).map(source => (
              <TabsContent key={source} className="pt-4" value={source}>
                <SettingsSources {...props} source={source as SourceKind} />
              </TabsContent>
            ))}
          </Tabs>
        ) : <p className="text-sm text-muted-foreground">{ADMIN_ONLY}</p>}
      </DialogContent>
    </Dialog>
  );
}
