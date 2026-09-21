import type { ConnectionInfo } from "../../shared/protocol";
import type { RefObject } from "react";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { SetupQr } from "./SetupQr";

export function PairingDialog({ credentials, urls, connected, open, onOpenChange, openerRef }: { credentials: Pick<ConnectionInfo, "origin" | "token">; urls: string[]; connected: boolean; open: boolean; onOpenChange: (open: boolean) => void; openerRef?: RefObject<HTMLButtonElement | null> }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="pairing-panel w-full max-w-2xl p-6 sm:p-8" showCloseButton={false} onCloseAutoFocus={event => { event.preventDefault(); openerRef?.current?.focus(); }}>
      <DialogHeader><DialogTitle>Pair a remote</DialogTitle><DialogDescription>On the same network, scan the QR, name your device and connect to this TV.</DialogDescription></DialogHeader>
      <div className="grid gap-6">
        <div className="min-w-0 space-y-3">
          <p className="text-sm text-muted-foreground">Open Couch on your phone, then enter the code shown here.</p>
          <ul className="grid gap-2">{urls.map(url => <li key={url}><a className="block rounded-lg border bg-muted/40 px-3 py-2 font-mono text-sm break-all hover:bg-muted" href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul>
        </div>
        {connected && urls[0] ? <div className="flex justify-center"><SetupQr url={urls[0]} credentials={credentials} /></div> : <p role="status">{connected ? "No network address available. Connect the TV to the network and reopen this dialog." : "Reconnecting to the TV. The QR will return when connected."}</p>}
      </div>
      <DialogFooter showCloseButton />
    </DialogContent>
  </Dialog>;
}
