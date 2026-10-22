import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PairingDialog } from "@/components/PairingDialog";
import { useSessionGate } from "@/session/session-context";
import { CouchChoice } from "@/sections/settings/this-device/CouchChoice";
import { deviceName } from "@/copy";
import type { Credentials } from "@/session/session";
import { CouchMark } from "@/components/CouchMark";

/**
 * The header switches the Couch this window shows, from where the TV names itself and muted like that name. Playback
 * outputs stay in Where it plays. The same Couch choice is in Settings, and before pairing (`inline`) it is the
 * pairing page's Change, after the address.
 */
export function CouchSwitch({ credentials, connected, status, installationName, inline = false }: {
  credentials: Credentials | null; connected: boolean; status: string; installationName?: string; inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pairing, setPairing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { host, remoteControlEnabled } = useSessionGate();
  const canPair = !!host && remoteControlEnabled;
  const name = deviceName(installationName);
  return <><Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      {inline ? <Button ref={trigger} variant="link" className="h-auto p-0 text-sm font-normal text-foreground underline" aria-label="Change Couch">Change</Button> : <Button ref={trigger} variant="ghost" className="-ml-2.5 min-w-0 shrink gap-2 text-lg font-semibold tracking-tight touch:min-w-11" aria-label={`${name}: ${status}`}>
        <CouchMark connected={connected} />
        <span className="max-w-40 truncate max-sm:max-w-24">{name}</span>
      </Button>}
    </PopoverTrigger>
    <PopoverContent align="start" className="max-h-(--radix-popover-content-available-height) w-96 max-w-[calc(100vw-1rem)] overflow-y-auto [&_[data-slot=field]]:grid-cols-1" onOpenAutoFocus={event => { event.preventDefault(); (event.currentTarget as HTMLElement).focus(); }}>
      <CouchChoice credentials={credentials} installationName={installationName} />
      {canPair && <Button variant="ghost" className="h-auto w-full justify-start gap-3 px-2.5 py-2 font-normal text-foreground" onClick={() => { setOpen(false); setPairing(true); }}><Plus aria-hidden="true" />Pair a device</Button>}
    </PopoverContent>
  </Popover>
  {canPair && <PairingDialog credentials={host} urls={host.urls} connected={connected} open={pairing} onOpenChange={setPairing} openerRef={trigger} />}
  </>;
}
