import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PairingDialog } from "@/components/PairingDialog";
import { useSessionGate } from "@/session/session-context";
import { CouchChoice } from "@/sections/settings/this-device/CouchChoice";
import { deviceName } from "@/copy";
import type { Credentials } from "@/session/session";
import { StatusDot } from "./StatusLine";

/**
 * The header switches the Couch this window shows. Playback outputs stay in the Mixer.
 * The same Couch choice is available before pairing and in Settings.
 */
export function CouchSwitch({ credentials, connected, status, installationName }: {
  credentials: Credentials | null; connected: boolean; status: string; installationName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pairing, setPairing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { host, remoteControlEnabled } = useSessionGate();
  const canPair = !!host && remoteControlEnabled;
  const name = deviceName(installationName);
  return <><Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button ref={trigger} variant="ghost" className="min-w-0 shrink gap-2 touch:min-w-11 max-sm:px-2" aria-label={`${name}: ${status}`}>
        <StatusDot connected={connected} />
        <span className="max-w-48 truncate max-sm:max-w-32">{name}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="max-h-(--radix-popover-content-available-height) w-96 max-w-[calc(100vw-1rem)] overflow-y-auto [&_[data-slot=field]]:grid-cols-1" onOpenAutoFocus={event => { event.preventDefault(); (event.currentTarget as HTMLElement).focus(); }}>
      <CouchChoice credentials={credentials} installationName={installationName} />
      {canPair && <Button variant="ghost" className="h-auto w-full justify-start gap-3 px-2.5 py-2 font-normal" onClick={() => { setOpen(false); setPairing(true); }}><Plus aria-hidden="true" />Pair a device</Button>}
    </PopoverContent>
  </Popover>
  {canPair && <PairingDialog credentials={host} urls={host.urls} connected={connected} open={pairing} onOpenChange={setPairing} openerRef={trigger} />}
  </>;
}
