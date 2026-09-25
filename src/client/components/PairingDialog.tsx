import type { ConnectionInfo } from "../../shared/protocol";
import type { RefObject } from "react";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { SetupQr } from "./SetupQr";

export function PairingDialog({ credentials, urls, connected, open, onOpenChange, openerRef }: { credentials: Pick<ConnectionInfo, "origin" | "token">; urls: string[]; connected: boolean; open: boolean; onOpenChange: (open: boolean) => void; openerRef?: RefObject<HTMLButtonElement | null> }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="w-[min(36rem,calc(100vw-2rem))] max-w-none gap-6 rounded-sm p-5 sm:p-8" showCloseButton={false} onCloseAutoFocus={event => { event.preventDefault(); openerRef?.current?.focus(); }}>
      <DialogHeader><DialogTitle className="text-2xl">Pair a remote</DialogTitle><DialogDescription className="text-sm">Scan with a phone on the same network, or open an address and enter the code.</DialogDescription></DialogHeader>
      {connected && urls[0] ? <SetupQr url={urls[0]} credentials={credentials} /> : <p role="status" className="text-sm text-muted-foreground">{connected ? "No network address available. Connect the TV to the network and reopen this dialog." : "Reconnecting to the TV. The QR will return when connected."}</p>}
      {!!urls.length && <section className="min-w-0 space-y-2" aria-label="Pairing addresses">
        <h3 className="text-sm font-medium">Open on your phone</h3>
        <ul className="grid gap-2">{urls.map(url => <li key={url}><a className="block break-all text-sm underline underline-offset-4" href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul>
      </section>}
      <DialogFooter showCloseButton />
    </DialogContent>
  </Dialog>;
}
