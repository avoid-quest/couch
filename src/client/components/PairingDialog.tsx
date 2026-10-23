import type { ConnectionInfo } from "../../shared/protocol";
import { useEffect, useRef, type RefObject } from "react";
import { ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { useOptionalSessionGate } from "@/session/session-context";
import { deviceName, offline } from "@/copy";
import { SetupQr } from "./SetupQr";
import { notice } from "@/toasts";

export function PairingDialog({ credentials, urls, connected, open, onOpenChange, openerRef }: { credentials: Pick<ConnectionInfo, "origin" | "token">; urls: string[]; connected: boolean; open: boolean; onOpenChange: (open: boolean) => void; openerRef?: RefObject<HTMLButtonElement | null> }) {
  const state = useOptionalSessionGate()?.state;
  const name = state?.installationName;
  const [url, ...alternatives] = urls;
  // A Device that pairs while the dialog is open closes it. The first one paired becomes the admin.
  const before = useRef<{ ids: Set<string>; admin?: boolean } | null>(null);
  useEffect(() => {
    if (!open || !state?.devices) { before.current = null; return; }
    const paired = before.current && state.devices.find(device => !before.current!.ids.has(device.id));
    if (paired) {
      notice(`${paired.name} paired${before.current!.admin === false && state.administratorClaimed ? " as admin" : ""}`);
      onOpenChange(false);
    }
    before.current = { ids: new Set(state.devices.map(device => device.id)), admin: state.administratorClaimed };
  }, [open, state?.devices, state?.administratorClaimed]);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="gap-8 sm:max-w-2xl" onCloseAutoFocus={event => { if (openerRef?.current) { event.preventDefault(); openerRef.current.focus(); } }}>
      <DialogHeader><DialogTitle>Pair a device</DialogTitle><DialogDescription>Connect to {deviceName(name)} on the same Wi-Fi.</DialogDescription></DialogHeader>
      {connected && url ? <div className="grid min-w-0 items-center gap-8 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid min-w-0 gap-4">
          <p className="text-body">Scan with your phone, or open this address and enter the code.</p>
          <a data-text-link className="w-fit break-all underline underline-offset-4 decoration-foreground/40 hover:decoration-foreground" href={url} target="_blank" rel="noreferrer">{url}</a>
          <p className="text-sm text-muted-foreground">{url.startsWith("https:") ? "Couch uses its own certificate. If your browser warns that the connection isn’t private, continue only for this address." : "HTTP is unencrypted. Use it only on a network you trust."}</p>
          {!!alternatives.length && <Collapsible>
            <CollapsibleTrigger asChild><Button variant="ghost" className="group -ml-3.5">Other addresses<ChevronDown aria-hidden="true" className="size-4 group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger>
            <CollapsibleContent className="grid gap-3 pt-3">
              <ul className="grid gap-2">{alternatives.map(address => <li key={address}><a data-text-link className="break-all underline underline-offset-4 decoration-foreground/40 hover:decoration-foreground" href={address} target="_blank" rel="noreferrer">{address}</a></li>)}</ul>
              {alternatives.some(address => address.startsWith("http:")) && <p className="text-sm text-muted-foreground">If your TV refuses HTTPS, try HTTP on a network you trust. HTTP is unencrypted.</p>}
            </CollapsibleContent>
          </Collapsible>}
        </div>
        <div className="max-sm:row-start-1"><SetupQr url={url} credentials={credentials} /></div>
      </div> : <p role="status" className="text-sm text-muted-foreground">{connected ? `No network. Connect ${deviceName(name)} to Wi-Fi or Ethernet.` : offline(name)}</p>}
    </DialogContent>
  </Dialog>;
}
