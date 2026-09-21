import type { ConnectionInfo } from "../../shared/protocol";
import type { RefObject } from "react";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { SetupQr } from "./SetupQr";

export function PairingDialog({ credentials, urls, connected, open, onOpenChange, openerRef }: { credentials: Pick<ConnectionInfo, "origin" | "token">; urls: string[]; connected: boolean; open: boolean; onOpenChange: (open: boolean) => void; openerRef?: RefObject<HTMLButtonElement | null> }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="pairing-panel" showCloseButton={false} onCloseAutoFocus={event => { event.preventDefault(); openerRef?.current?.focus(); }}>
      <DialogHeader><DialogTitle>Pair a remote</DialogTitle><DialogDescription>On the same network, scan the QR, name your device and connect to this TV.</DialogDescription></DialogHeader>
      <div className="pairing-options">
        {connected && urls[0] ? <SetupQr url={urls[0]} credentials={credentials} /> : <p role="status">{connected ? "No network address available. Connect the TV to the network and reopen this dialog." : "Reconnecting to the TV. The QR will return when connected."}</p>}
        <div className="min-w-0 space-y-3">
          <p>Or open an address and enter the pairing code:</p>
          <ul className="address-list">{urls.map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul>
        </div>
      </div>
      <DialogFooter showCloseButton />
    </DialogContent>
  </Dialog>;
}
