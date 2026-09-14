import type { ConnectionInfo } from "../shared/protocol";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { SetupQr } from "./SetupQr";

export function PairingDialog({ host, connected, open, onOpenChange }: { host: ConnectionInfo; connected: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="pairing-panel" showCloseButton={false} onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLButtonElement>(".pair-shortcut")?.focus(); }}>
      <DialogHeader><DialogTitle>Pair a remote</DialogTitle><DialogDescription>On the same network, scan the QR, name your device and connect to this TV.</DialogDescription></DialogHeader>
      <div className="pairing-options">
        {connected && host.urls[0] ? <SetupQr url={host.urls[0]} credentials={host} /> : <p role="status">{connected ? "No network address available. Connect the TV to the network and reopen this dialog." : "Reconnecting to the TV. The QR will return when connected."}</p>}
        <div className="min-w-0 space-y-3">
          <p>Or open an address and enter the code:</p>
          <ul className="address-list">{host.urls.map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul>
          <div className="pairing-display"><span>Pairing code</span><strong>{host.pairingCode}</strong></div>
        </div>
      </div>
      <DialogFooter showCloseButton />
    </DialogContent>
  </Dialog>;
}
