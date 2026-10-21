import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend, type ApiCredentials } from "@/api/client";
import { liveRelayQuery, localRelayQuery } from "@/api/settings";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkLiveRelay } from "@/session/check-live-relay";
import type { LiveRelay, LiveRelaySettings as RelaySettings, LocalRelayState } from "../../../../shared/live-relay";

const emptyRelay: LiveRelay = { urls: "", username: "", credential: "" };

/** The relay runs on the Couch; its checks run here, from the device in hand. */
export function LiveRelaySettings({ credentials, connected, device, couch, host }: { credentials: ApiCredentials; connected: boolean; device: string; couch: string; host: boolean }) {
  const client = useQueryClient();
  const query = useQuery({ ...liveRelayQuery(credentials), enabled: connected });
  const local = useQuery({ ...localRelayQuery(credentials), enabled: connected });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => apiSend<LocalRelayState>(credentials, "/api/settings/live-relay/local", { enabled }),
    onSuccess: result => { client.setQueryData(localRelayQuery(credentials).queryKey, result); check.reset(); setStatus(""); },
  });
  const [draft, setDraft] = useState<LiveRelay | null>(null);
  const relay = draft ?? query.data?.relay ?? emptyRelay;
  const [status, setStatus] = useState("");
  const checking = useRef<AbortController | null>(null);
  useEffect(() => () => checking.current?.abort(), []);
  const check = useMutation({
    mutationFn: async (value: LiveRelay) => {
      checking.current?.abort();
      const controller = checking.current = new AbortController();
      await checkLiveRelay(value, controller.signal);
    },
    onSuccess: () => setStatus(`Relay reachable from ${host ? "this device" : device}. Test playback on the receiving device too.`),
  });
  const save = useMutation({
    mutationFn: (value: LiveRelay | null) => apiSend<RelaySettings>(credentials, "/api/settings/live-relay", { relay: value }),
    onSuccess: result => {
      client.setQueryData(liveRelayQuery(credentials).queryKey, result);
      setDraft(null);
      setStatus(result.relay ? "Saved. New connections use this relay when needed. If a device is already Buffered, stop sharing and start again." : "Relay removed. New connections use the local network.");
    },
  });
  const busy = !connected || query.isPending || query.isError || save.isPending || check.isPending;
  const change = (key: keyof LiveRelay, value: string) => { setDraft({ ...relay, [key]: value }); setStatus(""); check.reset(); save.reset(); };
  const submit = (event: FormEvent) => { event.preventDefault(); if (!busy) { check.reset(); setStatus(""); save.mutate(relay); } };
  const localStatus = local.data?.error ?? (local.data?.status === "running" ? `Running on ${couch}. Only paired devices on this LAN can use it.`
    : local.data?.status === "starting" ? "Starting the bundled relay…"
    : local.data?.enabled ? "Waiting for Share on network and a usable LAN address." : "Off.");
  return <SettingsSection title="Live playback relay" description="For devices that can't connect directly to a shared screen or sound.">
    <SettingsRow label={`Run relay on ${couch}`} description="A device already Buffered needs its source shared again after you turn it on.">
      <Switch aria-label={`Run relay on ${couch}`} checked={toggle.isPending ? toggle.variables : local.data?.enabled ?? false} disabled={!connected || local.isPending || local.isError || toggle.isPending || check.isPending} onCheckedChange={enabled => toggle.mutate(enabled)} />
    </SettingsRow>
    {local.data?.error ? <Alert variant="destructive"><AlertDescription>{localStatus}</AlertDescription></Alert> : <p role="status" className="text-sm text-muted-foreground">{localStatus}</p>}
    {local.data?.enabled && <>
      <p className="text-sm text-muted-foreground">The built-in relay takes priority. Saved external relay settings are not used while this switch is on.</p>
      <SettingsRow label="Check from this device" description={`Tests whether ${host ? "this device" : device} can reach the relay. Test playback on the receiving device too.`}>
        <Button variant="outline" disabled={!connected || !local.data.relay || check.isPending} onClick={() => { setStatus(""); check.mutate(local.data!.relay!); }}>{check.isPending ? "Checking…" : "Check relay"}</Button>
      </SettingsRow>
    </>}
    {(local.error || toggle.error) && <Alert variant="destructive"><AlertDescription>{local.error?.message ?? toggle.error?.message}</AlertDescription>{local.isError && <AlertAction><Button variant="outline" onClick={() => void local.refetch()}>Try again</Button></AlertAction>}</Alert>}
    <Collapsible>
      <CollapsibleTrigger asChild><Button variant="ghost">External relay settings</Button></CollapsibleTrigger>
      <CollapsibleContent>
      <p className="py-3 text-sm text-muted-foreground">Optional: use an existing TURN service when the built-in relay is off. Get its address and credentials from your provider or network administrator.</p>
    <form onSubmit={submit}>
      <SettingsRow label="TURN address" htmlFor="live-relay-url" description="A turn: or turns: address, including its port and transport if required.">
        <Input id="live-relay-url" value={relay.urls} placeholder="turn:relay.example:3478?transport=tcp" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={2048} required disabled={busy} onChange={event => change("urls", event.target.value.trim())} />
      </SettingsRow>
      <SettingsRow label="Username" htmlFor="live-relay-username">
        <Input id="live-relay-username" value={relay.username} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={1024} required disabled={busy} onChange={event => change("username", event.target.value)} />
      </SettingsRow>
      <SettingsRow label="Password" htmlFor="live-relay-password" description="Saved on this Couch and shared only with its paired devices for live playback.">
        <Input id="live-relay-password" type="password" value={relay.credential} autoComplete="new-password" maxLength={1024} required disabled={busy} onChange={event => change("credential", event.target.value)} />
      </SettingsRow>
      <div className="flex flex-wrap gap-2 pt-3">
        <Button type="submit" disabled={busy || !relay.urls || !relay.username || !relay.credential || !draft}>{save.isPending ? "Saving…" : "Save relay"}</Button>
        <Button type="button" variant="outline" disabled={busy || !!draft || !query.data?.relay || local.data?.enabled} onClick={() => { setStatus(""); check.mutate(query.data!.relay!); }}>{check.isPending ? "Checking…" : "Check saved relay from this device"}</Button>
        <Button type="button" variant="ghost" disabled={busy || !query.data?.relay} onClick={() => { check.reset(); setStatus(""); save.mutate(null); }}>Remove relay</Button>
      </div>
    </form>
      </CollapsibleContent>
    </Collapsible>
    {query.data?.source === "environment" && <p className="text-sm text-muted-foreground">Using launch settings. Saving or removing a relay here overrides them, including after restarting Couch.</p>}
    {status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
    {(query.error || save.error || check.error) && <Alert variant="destructive"><AlertDescription>{query.error?.message ?? save.error?.message ?? check.error?.message}{check.error && " Low-delay playback has not been verified."}</AlertDescription>{query.isError && <AlertAction><Button variant="outline" disabled={!connected} onClick={() => void query.refetch()}>Try again</Button></AlertAction>}</Alert>}
  </SettingsSection>;
}
