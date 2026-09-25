import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiSend } from "@/api/client";
import { jellyfinQuery } from "@/api/jellyfin";
import type { JellyfinConnection, JellyfinStatus } from "../../../../shared/jellyfin";
import type { SourceCredentials } from "@/components/sourceTypes";

type Props = { credentials: SourceCredentials | null; connected: boolean; canManage: boolean };
type Connection = JellyfinConnection | JellyfinStatus;
const isConnection = (value: Connection | null): value is JellyfinConnection => !!value && "url" in value;
const empty: SourceCredentials = { origin: "", token: "" };

export function JellyfinSettings({ credentials, connected, canManage }: Props) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const available = connected && !!credentials;
  const page = useQuery({ ...jellyfinQuery(credentials ?? empty, canManage), enabled: available });
  const connection = page.data ?? null;
  const savedUrl = isConnection(connection) ? connection.url : null;
  const mutation = useMutation({
    mutationFn: (action: "connect" | "test" | "disconnect") => apiSend(credentials!, `/api/jellyfin${action === "test" ? "/test" : ""}`, action === "connect" ? { url: url.trim(), username: username.trim(), password } : undefined, action === "disconnect" ? "DELETE" : "POST"),
    onSuccess: async (_, action) => {
      if (action === "test") return;
      await queryClient.invalidateQueries({ queryKey: ["jellyfin"] });
      setEditing(false); setConfirmDisconnect(false);
    },
    onSettled: () => setPassword(""),
  });
  const pending = mutation.isPending ? mutation.variables : null;
  const canWrite = available && canManage && !pending;
  const error = mutation.error ? mutation.error.message || "Could not update Jellyfin." : null;
  const notice = mutation.isSuccess ? mutation.variables === "connect" ? "Connection tested and saved." : mutation.variables === "test" ? "Jellyfin accepted the saved connection." : "Jellyfin disconnected. Its saved access token was removed." : null;

  function update(action: "connect" | "test" | "disconnect", event?: FormEvent) {
    event?.preventDefault();
    if (credentials && canWrite) mutation.mutate(action);
  }

  const reconnect = () => {
    setUrl(savedUrl ?? "");
    setUsername(connection?.username ?? "");
    setPassword("");
    setEditing(true);
    setConfirmDisconnect(false);
    mutation.reset();
  };

  return (
    <section aria-label="Jellyfin settings" className="min-w-0 space-y-4">
      <div className="space-y-1"><h3 className="text-base font-semibold">Jellyfin</h3><p className="text-muted-foreground">Every paired remote uses this Jellyfin account. Its history belongs to that account, separately from Couch watching profiles and administrator roles.</p></div>
      {page.isFetching && <p className="text-muted-foreground" role="status">Loading Jellyfin connection…</p>}
      {connection?.connected && (
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
          <dt className="text-muted-foreground">Server</dt><dd className="min-w-0 break-words">{connection.serverName}</dd>
          <dt className="text-muted-foreground">Account</dt><dd className="min-w-0 break-words">{connection.username || "Connected Jellyfin account"}</dd>
          {canManage && savedUrl && <><dt className="text-muted-foreground">Address</dt><dd className="min-w-0 break-all">{savedUrl}</dd></>}
          <dt className="text-muted-foreground">Connection</dt><dd><Badge variant="secondary">Saved</Badge></dd>
        </dl>
      )}
      {!canManage ? <p className="text-muted-foreground">An administrator can manage this connection. You can browse and play the connected library from Jellyfin.</p> : <>
        {connection?.connected && !editing && !confirmDisconnect && (
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" disabled={!canWrite} onClick={() => update("test")} variant="outline">{pending === "test" ? "Testing…" : "Test connection"}</Button>
            <Button className="min-h-11" onClick={reconnect} variant="outline">Reconnect or replace</Button>
            <Button className="min-h-11" data-action="jellyfin-disconnect" disabled={!canWrite} onClick={() => { setConfirmDisconnect(true); mutation.reset(); }} variant="outline">Disconnect</Button>
          </div>
        )}
        {confirmDisconnect && (
          <div className="space-y-3 border-t border-border py-3">
            <p>Disconnecting removes the saved access token and stops any item playing from this Jellyfin connection on the TV. Your Jellyfin library and watching history stay on its server.</p>
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-11" disabled={!canWrite} onClick={() => update("disconnect")} variant="destructive">{pending === "disconnect" ? "Disconnecting…" : "Disconnect and stop Jellyfin"}</Button>
              <Button className="min-h-11" onClick={() => setConfirmDisconnect(false)} variant="outline">Cancel</Button>
            </div>
          </div>
        )}
        {connection && (!connection.connected || editing) && (
          <form className="space-y-4" onSubmit={event => update("connect", event)}>
            <div className="space-y-2"><Label htmlFor="jellyfin-url">Jellyfin server URL</Label><Input autoComplete="url" className="min-h-11" disabled={!canWrite} id="jellyfin-url" maxLength={2048} onChange={event => setUrl(event.target.value)} placeholder="http://192.168.1.10:8096" required type="url" value={url} /></div>
            <div className="space-y-2"><Label htmlFor="jellyfin-user">Username</Label><Input autoCapitalize="none" autoComplete="username" className="min-h-11" disabled={!canWrite} id="jellyfin-user" maxLength={200} onChange={event => setUsername(event.target.value)} required spellCheck={false} value={username} /></div>
            <div className="space-y-2"><Label htmlFor="jellyfin-password">Password</Label><Input autoComplete="current-password" className="min-h-11" disabled={!canWrite} id="jellyfin-password" maxLength={4096} onChange={event => setPassword(event.target.value)} type="password" value={password} /></div>
            <p className="text-muted-foreground">The TV saves an access token, never your password. {connection.connected && "Your existing connection stays saved if this test fails. Replacing it stops its current Jellyfin playback."}</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!canWrite}>{pending === "connect" ? "Testing connection…" : connection.connected ? "Test and replace connection" : "Test and connect"}</Button>
              {editing && <Button className="min-h-11" disabled={!canWrite} onClick={() => { setEditing(false); setPassword(""); mutation.reset(); }} type="button" variant="outline">Cancel</Button>}
            </div>
          </form>
        )}
      </>}
      {!connected && <p className="text-muted-foreground" role="status">Connect this remote to the TV to use Jellyfin settings.</p>}
      {(page.error || error) && <Alert variant="destructive" className="rounded-none border-x-0 border-t-0 border-b border-border bg-transparent px-0"><AlertDescription>{error ?? "Could not load Jellyfin settings."}</AlertDescription></Alert>}
      {notice && <p className="text-primary" role="status">{notice}</p>}
    </section>
  );
}
