import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Controller } from "../shared/controllers";

type Props = {
  devices: Controller[];
  currentId: string;
  disabled: boolean;
  update: (event: { preventDefault(): void }, path: string, body: unknown, success: string, method?: "POST" | "DELETE") => Promise<boolean>;
};

function Remote({ device, currentId, disabled, update, lastAdministrator }: Omit<Props, "devices"> & { device: Controller; lastAdministrator: boolean }) {
  const [name, setName] = useState(device.name);
  const [confirmation, setConfirmation] = useState<"role" | "revoke" | null>(null);
  useEffect(() => { setName(device.name); setConfirmation(null); }, [device.name, device.role]);
  const nextRole = device.role === "administrator" ? "controller" : "administrator";
  const roleAction = nextRole === "administrator" ? "Approve administrator" : "Remove administration";
  return <li className="min-w-0 space-y-3 rounded-lg border p-3" data-controller-id={device.id}>
    <div className="flex flex-wrap items-center gap-2"><p className="min-w-0 break-words font-medium">{device.name}{device.id === currentId ? " · This browser" : ""}</p><Badge variant="secondary">{device.role === "administrator" ? "Administrator" : "Controller"}</Badge></div>
    <p className="text-muted-foreground">Last seen {device.lastSeenAt === null ? "unknown" : new Date(device.lastSeenAt).toLocaleString()}</p>
    <form className="space-y-2" onSubmit={event => void update(event, `/api/controllers/${device.id}/name`, { name: name.trim() }, "Remote name saved.")}>
      <Label htmlFor={`remote-${device.id}`}>Name this remote</Label>
      <Input className="min-h-11" id={`remote-${device.id}`} value={name} onChange={event => setName(event.target.value)} maxLength={60} disabled={disabled} required />
      <Button className="min-h-11" variant="outline" disabled={disabled || !name.trim() || name.trim() === device.name}>Save remote name</Button>
    </form>
    <div className="flex flex-wrap gap-2">
      <Button className="min-h-11" variant="outline" disabled={disabled || lastAdministrator} onClick={() => setConfirmation("role")}>{roleAction}</Button>
      <Button className="min-h-11" variant="destructive" disabled={disabled || lastAdministrator} onClick={() => setConfirmation("revoke")}>Revoke access</Button>
    </div>
    {lastAdministrator && <p className="text-muted-foreground">Keep this administrator until another remote is approved.</p>}
    {confirmation && <div className="space-y-3 rounded-md border p-3" role="alert">
      <p>{confirmation === "revoke" ? `Revoke ${device.name}? Its open connections will close and it must pair again.` : nextRole === "administrator" ? `Allow ${device.name} to change TV settings and manage every paired remote?` : `Remove administration from ${device.name}? It will keep browsing and playback controls.`}</p>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" variant="outline" disabled={disabled} onClick={() => setConfirmation(null)}>Cancel</Button>
        <Button className="min-h-11" disabled={disabled} variant={confirmation === "revoke" ? "destructive" : "default"} onClick={event => void update(event, `/api/controllers/${device.id}${confirmation === "role" ? "/role" : ""}`, confirmation === "role" ? { role: nextRole } : undefined, confirmation === "role" ? "Remote role updated." : "Remote access revoked.", confirmation === "role" ? "POST" : "DELETE").then(saved => { if (saved) setConfirmation(null); })}>{confirmation === "revoke" ? "Confirm revocation" : roleAction}</Button>
      </div>
    </div>}
  </li>;
}

export function PairedRemotes({ devices, ...props }: Props) {
  const administrators = devices.filter(device => device.role === "administrator").length;
  return <section className="space-y-3" aria-label="Paired remotes">
    <h3 className="font-medium">Paired remotes</h3>
    <p className="text-muted-foreground">Administrators manage this TV and every paired remote. Controller pairing grants browsing and playback only.</p>
    <ul className="space-y-3">{devices.map(device => <Remote key={device.id} device={device} lastAdministrator={device.role === "administrator" && administrators === 1} {...props} />)}</ul>
  </section>;
}
