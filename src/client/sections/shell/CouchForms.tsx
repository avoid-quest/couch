import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { SettingsRow } from "@/components/SettingsRow";

/** Another Couch's address, in first run, Settings and the Couch switch. children replace Connect, as first run's confirmation does. */
export function AnotherCouchForm({ description, address, onAddressChange, onConnect, pending = false, className, children }: {
  description: string; address: string; onAddressChange: (address: string) => void; onConnect: () => void; pending?: boolean; className?: string; children?: ReactNode;
}) {
  return <SettingsRow label="Another Couch" htmlFor="another-couch-address" description={description} className={className}>
    <form className="flex w-full flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); onConnect(); }}>
      <Input id="another-couch-address" className="min-w-0 flex-1" value={address} onChange={event => onAddressChange(event.target.value)} placeholder="e.g. 192.168.1.10:4100" autoComplete="url" spellCheck={false} required disabled={pending} />
      {children ?? <Button type="submit" variant="outline" disabled={pending || !address.trim()}>{pending ? "Connecting…" : "Connect"}</Button>}
    </form>
  </SettingsRow>;
}

/** Forgetting a saved Couch drops this device's pairing with it; that Couch keeps playing. Open while name is set. */
export function ForgetCouchDialog({ name, onForget, onClose, pending = false, error, onCloseAutoFocus }: {
  name: string | null; onForget: () => boolean | Promise<boolean>; onClose: () => void; pending?: boolean; error?: string | null;
  onCloseAutoFocus?: ComponentProps<typeof AlertDialogContent>["onCloseAutoFocus"];
}) {
  return <AlertDialog open={name !== null} onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <AlertDialogContent data-tv-local-only onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onCloseAutoFocus={onCloseAutoFocus}>
      <AlertDialogHeader><AlertDialogTitle>Forget {name}?</AlertDialogTitle><AlertDialogDescription>That Couch keeps playing. You'll need to pair again to reconnect.</AlertDialogDescription></AlertDialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={pending} onClick={async event => { event.preventDefault(); if (await onForget()) onClose(); }}>{pending ? "Forgetting…" : "Forget"}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
