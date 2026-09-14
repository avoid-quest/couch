import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsSources } from "./SettingsSources";

const sources = { jellyfin: "Jellyfin", iptv: "IPTV", folders: "Local folders", radio: "Radio playlist", "streaming-community": "StreamingCommunity" };
export type SourceSetupKind = keyof typeof sources;
type Props = React.ComponentProps<typeof SettingsSources> & { localOnly?: boolean; open: boolean; onOpenChange: (open: boolean) => void };

export function SourceSetupDialog({ open, onOpenChange, localOnly, source: initialSource, ...props }: Props) {
  const trigger = useRef<HTMLElement | null>(null);
  const [source, setSource] = useState(initialSource ?? "jellyfin");
  useEffect(() => { if (open) setSource(initialSource ?? "jellyfin"); }, [open, initialSource]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent data-tv-local-only={localOnly || undefined} onOpenAutoFocus={() => { trigger.current = document.activeElement as HTMLElement; }} onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); }} className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Add source</DialogTitle><DialogDescription>Sources are saved on the selected playback computer.</DialogDescription></DialogHeader>
    {props.canManage ? <Tabs value={source} onValueChange={setSource}><TabsList className="h-auto w-full flex-wrap" aria-label="Source type">{Object.entries(sources).map(([value, label]) => <TabsTrigger className="min-h-11" key={value} value={value}>{label}</TabsTrigger>)}</TabsList><TabsContent value={source} className="pt-4"><SettingsSources {...props} source={source} /></TabsContent></Tabs> : <p>An administrator can add or update sources. You can browse and play the sources already connected.</p>}
  </DialogContent></Dialog>;
}
