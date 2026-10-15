import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiSend, type ApiCredentials } from "@/api/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/** Rename button and dialog for the Couch's name, which every device shows. Admins only. */
export function RenameCouch({ credentials, connected, name, onRenamed }: { credentials: ApiCredentials; connected: boolean; name: string; onRenamed?: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const rename = useMutation({
    mutationFn: (value: string) => apiSend(credentials, "/api/settings", { name: value }),
    onSuccess: () => { setOpen(false); onRenamed?.(); },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!rename.isPending) rename.mutate(draft.trim());
  }
  return <>
    <Button variant="outline" disabled={!connected || rename.isPending} onClick={() => { rename.reset(); setDraft(name); setOpen(true); }}>Rename</Button>
    <Dialog open={open} onOpenChange={value => { if (!value && !rename.isPending) setOpen(false); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Rename {name}</DialogTitle><DialogDescription>Every device shows the new name.</DialogDescription></DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <Field><FieldLabel htmlFor="device-rename">Name</FieldLabel><Input id="device-rename" autoFocus autoComplete="off" maxLength={60} value={draft} onChange={event => setDraft(event.target.value)} required disabled={rename.isPending} /></Field>
          {rename.error && <Alert variant="destructive"><AlertDescription>{rename.error.message || "Couldn't rename the device."}</AlertDescription></Alert>}
          <DialogFooter><Button type="button" variant="ghost" disabled={rename.isPending} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={!connected || rename.isPending || !draft.trim() || draft.trim() === name}>{rename.isPending ? "Saving…" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
