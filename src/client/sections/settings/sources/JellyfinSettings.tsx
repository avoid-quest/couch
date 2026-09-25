import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ADMIN_ONLY, deviceName } from "@/copy";
import { apiSend } from "@/api/client";
import { jellyfinQuery } from "@/api/jellyfin";
import type { JellyfinConnection, JellyfinStatus } from "../../../../shared/jellyfin";
import type { SourceCredentials, SourceSettingsProps } from "@/components/sourceTypes";

type Connection = JellyfinConnection | JellyfinStatus;
type Action = "connect" | "test" | "disconnect";
const isConnection = (value: Connection | null): value is JellyfinConnection => !!value && "url" in value;
const empty: SourceCredentials = { origin: "", token: "" };
const notices: Record<Action, string> = { connect: "Connected.", test: "Connection works.", disconnect: "Disconnected." };

export function JellyfinSettings({ credentials, connected, canManage, hostName }: SourceSettingsProps) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState(false);
  const available = connected && !!credentials;
  const page = useQuery({ ...jellyfinQuery(credentials ?? empty, canManage), enabled: available });
  const connection = page.data ?? null;
  const savedUrl = isConnection(connection) ? connection.url : null;
  const mutation = useMutation({
    mutationFn: (action: Action) => apiSend(credentials!, `/api/jellyfin${action === "test" ? "/test" : ""}`, action === "connect" ? { url: url.trim(), username: username.trim(), password } : undefined, action === "disconnect" ? "DELETE" : "POST"),
    onSuccess: async (_, action) => {
      toast(notices[action]);
      if (action === "test") return;
      await queryClient.invalidateQueries({ queryKey: ["jellyfin"] });
      setEditing(false);
    },
    onSettled: () => setPassword(""),
  });
  const pending = mutation.isPending ? mutation.variables : null;
  const canWrite = available && canManage && !pending;
  const error = mutation.error ? mutation.error.message || "Couldn't reach Jellyfin." : page.error ? "Couldn't load Jellyfin settings." : null;

  function update(action: Action, event?: FormEvent) {
    event?.preventDefault();
    if (credentials && canWrite) mutation.mutate(action);
  }
  const edit = (value: boolean) => {
    setUrl(value ? savedUrl ?? "" : ""); setUsername(value ? connection?.username ?? "" : ""); setPassword("");
    setEditing(value); mutation.reset();
  };
  const showForm = canManage && connection && (!connection.connected || editing);

  return (
    <div className="flex min-w-0 flex-col gap-8" data-jellyfin-settings>
      <SettingsSection description="All remotes share this Jellyfin account.">
        {available && page.isPending && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading…</p>}
        {connection?.connected && <>
          <SettingsRow label="Server"><span className="min-w-0 break-words text-sm">{connection.serverName}</span></SettingsRow>
          <SettingsRow label="Account"><span className="min-w-0 break-words text-sm">{connection.username || "Signed in"}</span></SettingsRow>
          {canManage && savedUrl && <SettingsRow label="Address"><span className="min-w-0 break-all text-sm">{savedUrl}</span></SettingsRow>}
        </>}
        {!canManage && <p className="text-sm text-muted-foreground">{ADMIN_ONLY}</p>}
        {canManage && connection?.connected && !editing && <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!canWrite} onClick={() => update("test")}>{pending === "test" ? "Testing…" : "Test"}</Button>
          <Button variant="outline" onClick={() => edit(true)}>Change account</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="ghost" data-action="jellyfin-disconnect" disabled={!canWrite}>Disconnect</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect Jellyfin?</AlertDialogTitle>
                <AlertDialogDescription>Jellyfin playback stops. Your library stays on the server.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => update("disconnect")}>Disconnect</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      </SettingsSection>
      {showForm && <form onSubmit={event => update("connect", event)}>
        <SettingsSection title={connection.connected ? "Change account" : "Connect"} description={`${deviceName(hostName)} stores a token, not your password.`}>
          <SettingsRow label="Server address" htmlFor="jellyfin-url">
            <Input autoComplete="url" className="w-full" disabled={!canWrite} id="jellyfin-url" maxLength={2048} onChange={event => setUrl(event.target.value)} placeholder="http://192.168.1.10:8096" required type="url" value={url} />
          </SettingsRow>
          <SettingsRow label="Username" htmlFor="jellyfin-user">
            <Input autoCapitalize="none" autoComplete="username" className="w-full" disabled={!canWrite} id="jellyfin-user" maxLength={200} onChange={event => setUsername(event.target.value)} required spellCheck={false} value={username} />
          </SettingsRow>
          <SettingsRow label="Password" htmlFor="jellyfin-password">
            <Input autoComplete="current-password" className="w-full" disabled={!canWrite} id="jellyfin-password" maxLength={4096} onChange={event => setPassword(event.target.value)} type="password" value={password} />
          </SettingsRow>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!canWrite}>{pending === "connect" ? "Connecting…" : connection.connected ? "Replace" : "Connect"}</Button>
            {editing && <Button type="button" variant="outline" onClick={() => edit(false)}>Cancel</Button>}
          </div>
        </SettingsSection>
      </form>}
    </div>
  );
}
