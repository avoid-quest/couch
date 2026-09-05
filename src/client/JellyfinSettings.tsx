import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { JellyfinConnection, JellyfinStatus } from "../shared/jellyfin";

type Props = {
  credentials: { origin: string; token: string } | null;
  connected: boolean;
  canManage: boolean;
  version: number;
};

export function JellyfinSettings({ credentials, connected, canManage, version }: Props) {
  const [connection, setConnection] = useState<JellyfinConnection | JellyfinStatus | null>(null);
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const origin = credentials?.origin, token = credentials?.token;
  const canWrite = connected && canManage && !loading && !pending;

  useEffect(() => {
    setConnection(null); setUrl(""); setUsername(""); setPassword(""); setEditing(false); setConfirmDisconnect(false); setPending(null); setNotice(null);
    return () => mutation.current?.abort();
  }, [origin, token, canManage]);

  useEffect(() => {
    if (!origin || !token || !connected) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`${origin}/api/jellyfin${canManage ? "/connection" : ""}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Could not load Jellyfin settings.");
      if (!controller.signal.aborted) setConnection(value);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load Jellyfin settings."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [origin, token, connected, canManage, version]);

  async function update(action: "connect" | "test" | "disconnect", event?: FormEvent) {
    event?.preventDefault();
    if (!credentials || !canWrite) return;
    const controller = new AbortController();
    mutation.current = controller;
    setPending(action); setError(null); setNotice(null);
    try {
      const response = await fetch(`${credentials.origin}/api/jellyfin${action === "test" ? "/test" : ""}`, {
        method: action === "disconnect" ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" },
        body: action === "connect" ? JSON.stringify({ url: url.trim(), username: username.trim(), password }) : undefined,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Could not update Jellyfin.");
      if (controller.signal.aborted) return;
      setConnection({ ...value, ...(canManage ? { url: action === "connect" ? url.trim() : action === "disconnect" ? null : connection && "url" in connection ? connection.url : null } : {}) });
      if (action !== "test") { setEditing(false); setConfirmDisconnect(false); }
      setNotice(action === "connect" ? "Connection tested and saved." : action === "test" ? "Jellyfin accepted the saved connection." : "Jellyfin disconnected. Its saved access token was removed.");
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not update Jellyfin.");
    } finally {
      if (!controller.signal.aborted) { setPassword(""); setPending(null); }
      if (mutation.current === controller) mutation.current = null;
    }
  }

  const reconnect = () => {
    setUrl(connection && "url" in connection ? connection.url ?? "" : "");
    setUsername(connection?.username ?? ""); setPassword(""); setEditing(true); setConfirmDisconnect(false); setError(null); setNotice(null);
  };

  return <section className="min-w-0 space-y-4" aria-label="Jellyfin settings">
    <div className="space-y-1"><h3 className="text-base font-semibold">Jellyfin</h3><p className="text-muted-foreground">Every paired remote uses this Jellyfin account. Its history belongs to that account, separately from Couch watching profiles and administrator roles.</p></div>
    {loading && <p role="status" className="text-muted-foreground">Loading Jellyfin connection…</p>}
    {connection?.connected && <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
      <dt className="text-muted-foreground">Server</dt><dd className="min-w-0 break-words">{connection.serverName}</dd>
      <dt className="text-muted-foreground">Account</dt><dd className="min-w-0 break-words">{connection.username || "Connected Jellyfin account"}</dd>
      {canManage && "url" in connection && <><dt className="text-muted-foreground">Address</dt><dd className="min-w-0 break-all">{connection.url}</dd></>}
      <dt className="text-muted-foreground">Connection</dt><dd><Badge variant="secondary">Saved</Badge></dd>
    </dl>}
    {!canManage ? <p className="text-muted-foreground">An administrator can manage this connection. You can browse and play the connected library from Jellyfin.</p> : <>
      {connection?.connected && !editing && !confirmDisconnect && <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => void update("test")}>{pending === "test" ? "Testing…" : "Test connection"}</Button>
        <Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={reconnect}>Reconnect or replace</Button>
        <Button variant="outline" className="min-h-11" data-action="jellyfin-disconnect" disabled={!canWrite} onClick={() => { setConfirmDisconnect(true); setError(null); setNotice(null); }}>Disconnect</Button>
      </div>}
      {confirmDisconnect && <div className="space-y-3 rounded-lg border p-3">
        <p>Disconnecting removes the saved access token and stops any item playing from this Jellyfin connection on the TV. Your Jellyfin library and watching history stay on its server.</p>
        <div className="flex flex-wrap gap-2"><Button variant="destructive" className="min-h-11" disabled={!canWrite} onClick={() => void update("disconnect")}>{pending === "disconnect" ? "Disconnecting…" : "Disconnect and stop Jellyfin"}</Button><Button variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => setConfirmDisconnect(false)}>Cancel</Button></div>
      </div>}
      {connection && (!connection.connected || editing) && <form className="jellyfin-connect space-y-4" onSubmit={event => void update("connect", event)}>
        <div className="space-y-2"><Label htmlFor="jellyfin-url">Jellyfin server URL</Label><Input id="jellyfin-url" className="min-h-11" type="url" placeholder="http://192.168.1.10:8096" value={url} onChange={event => setUrl(event.target.value)} required maxLength={2048} disabled={!canWrite} autoComplete="url" /></div>
        <div className="space-y-2"><Label htmlFor="jellyfin-user">Username</Label><Input id="jellyfin-user" className="min-h-11" value={username} onChange={event => setUsername(event.target.value)} required maxLength={200} disabled={!canWrite} autoComplete="username" autoCapitalize="none" spellCheck={false} /></div>
        <div className="space-y-2"><Label htmlFor="jellyfin-password">Password</Label><Input id="jellyfin-password" className="min-h-11" type="password" value={password} onChange={event => setPassword(event.target.value)} maxLength={4096} disabled={!canWrite} autoComplete="current-password" /></div>
        <p className="text-muted-foreground">The TV saves an access token, never your password. {connection.connected && "Your existing connection stays saved if this test fails. Replacing it stops its current Jellyfin playback."}</p>
        <div className="flex flex-wrap gap-2"><Button className="primary-button min-h-11" disabled={!canWrite}>{pending === "connect" ? "Testing connection…" : connection.connected ? "Test and replace connection" : "Test and connect"}</Button>{editing && <Button type="button" variant="outline" className="min-h-11" disabled={!canWrite} onClick={() => { setEditing(false); setPassword(""); setError(null); }}>Cancel</Button>}</div>
      </form>}
    </>}
    {!connected && <p role="status" className="text-muted-foreground">Connect this remote to the TV to use Jellyfin settings.</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
