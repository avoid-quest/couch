import type { ConnectionInfo } from "../../shared/protocol";
import { useEffect, useRef, type RefObject } from "react";
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useOptionalSessionGate } from "@/session/session-context";
import { deviceName, offline } from "@/copy";
import { SetupQr } from "./SetupQr";
import { notice } from "@/toasts";

export function PairingDialog({ credentials, urls, connected, open, onOpenChange, openerRef }: { credentials: Pick<ConnectionInfo, "origin" | "token">; urls: string[]; connected: boolean; open: boolean; onOpenChange: (open: boolean) => void; openerRef?: RefObject<HTMLButtonElement | null> }) {
  const state = useOptionalSessionGate()?.state;
  const name = state?.installationName;
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
    <DialogContent className="gap-6 sm:max-w-lg" showCloseButton={false} onCloseAutoFocus={event => { event.preventDefault(); openerRef?.current?.focus(); }}>
      <DialogHeader><DialogTitle>Pair a device</DialogTitle><DialogDescription>Scan with a phone on the same Wi-Fi, or open an address below.</DialogDescription></DialogHeader>
      {connected && urls[0] ? <SetupQr url={urls[0]} credentials={credentials} /> : <p role="status" className="text-sm text-muted-foreground">{connected ? `No network. Connect ${deviceName(name)} to Wi-Fi or Ethernet.` : offline(name)}</p>}
      {!!urls.length && <section className="grid min-w-0 gap-2" aria-label="Pairing addresses">
        <h3 className="text-base font-medium">Open on your device</h3>
        <ul className="grid gap-1">{urls.map(url => <li key={url}><a data-text-link className="text-sm break-all underline underline-offset-4 hover:text-muted-foreground" href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul>
        <p className="text-sm text-muted-foreground">HTTPS uses Couch's own certificate. If the browser shows a privacy warning, continue only for your Couch's address.</p>
        {urls.some(url => url.startsWith("https:")) && urls.some(url => url.startsWith("http:")) && <p className="text-sm text-muted-foreground">If your TV refuses HTTPS, use an HTTP address. HTTP is unencrypted: use it only on a network you trust.</p>}
      </section>}
      <DialogFooter showCloseButton />
    </DialogContent>
  </Dialog>;
}
