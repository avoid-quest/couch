import { useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsSources } from "@/sections/settings/SettingsSources";
import type { SourceKind, SourceSettingsProps } from "@/components/sourceTypes";

const sources = { jellyfin: "Jellyfin", iptv: "IPTV", folders: "Local folders", radio: "Radio playlist", "streaming-community": "StreamingCommunity" } as const;
export type SourceSetupKind = keyof typeof sources;
type Props = SourceSettingsProps & { localOnly?: boolean; open: boolean; onOpenChange: (open: boolean) => void; source?: SourceKind };

export function SourceSetupDialog({ open, onOpenChange, localOnly, source: initialSource, ...props }: Props) {
  const trigger = useRef<HTMLElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-tv-local-only={localOnly || undefined}
        onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); }}
        onOpenAutoFocus={() => { trigger.current = document.activeElement as HTMLElement; }}
      >
        <DialogHeader><DialogTitle>Add source</DialogTitle><DialogDescription>Sources are saved on the selected playback computer.</DialogDescription></DialogHeader>
        {props.canManage ? (
          <Tabs defaultValue={initialSource ?? "jellyfin"} key={initialSource ?? "jellyfin"}>
            <TabsList aria-label="Source type" className="h-auto w-full flex-wrap justify-start">
              {Object.entries(sources).map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}
            </TabsList>
            {Object.keys(sources).map(source => (
              <TabsContent key={source} className="pt-4" value={source}>
                <SettingsSources {...props} source={source as SourceKind} />
              </TabsContent>
            ))}
          </Tabs>
        ) : <p>An administrator can add or update sources. You can browse and play the sources already connected.</p>}
      </DialogContent>
    </Dialog>
  );
}
