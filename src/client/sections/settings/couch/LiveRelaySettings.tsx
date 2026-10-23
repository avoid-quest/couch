import { Switch } from "@/components/ui/switch";
import { ChevronDown } from "lucide-react";
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
import { notice } from "@/toasts";
import type { LiveRelay, LiveRelaySettings as RelaySettings, LocalRelayState } from "../../../../shared/live-relay";

const emptyRelay: LiveRelay = { urls: "", username: "", credential: "" };

/** The relay runs on the Couch; its checks run here, from the device in hand. */
export function LiveRelaySettings({ credentials, connected, device, couch, host }: { credentials: ApiCredentials; connected: boolean; device: string; couch: string; host: boolean }) {
  const client = useQueryClient();
  const query = useQuery({ ...liveRelayQuery(credentials), enabled: connected });
  const local = useQuery({ ...localRelayQuery(credentials), enabled: connected });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => apiSend<LocalRelayState>(credentials, "/api/settings/live-relay/local", { enabled }),
    onSuccess: result => { client.setQueryData(localRelayQuery(credentials).queryKey, result); check.reset(); },
  });
  const [draft, setDraft] = useState<LiveRelay | null>(null);
  const relay = draft ?? query.data?.relay ?? emptyRelay;
  const checking = useRef<AbortController | null>(null);
  useEffect(() => () => checking.current?.abort(), []);
  const check = useMutation({
    mutationFn: async (value: LiveRelay) => {
      checking.current?.abort();
      const controller = checking.current = new AbortController();
      await checkLiveRelay(value, controller.signal);
    },
    onSuccess: () => notice(`Relay reachable from ${host ? "this device" : device}. Test playback on the receiving device too.`),
  });
  const save = useMutation({
    mutationFn: (value: LiveRelay | null) => apiSend<RelaySettings>(credentials, "/api/settings/live-relay", { relay: value }),
    onSuccess: result => {
      client.setQueryData(liveRelayQuery(credentials).queryKey, result);
      setDraft(null);
      notice(result.relay ? "External relay saved" : "External relay removed");
    },
  });
  const busy = !connected || query.isPending || query.isError || save.isPending || check.isPending;
  const change = (key: keyof LiveRelay, value: string) => { setDraft({ ...relay, [key]: value }); check.reset(); save.reset(); };
  const submit = (event: FormEvent) => { event.preventDefault(); if (!busy) { check.reset(); save.mutate(relay); } };
  const localStatus = local.data?.status === "running" ? "Only paired devices on this network can use it."
    : local.data?.status === "starting" ? "Starting the bundled relay…"
    : local.data?.status === "waiting" ? "Waiting for Share on network and a usable LAN address."
    : local.data && !local.data.enabled && query.data?.relay ? query.data.source === "environment" ? "Using an external relay from launch settings." : "Using the saved external relay." : undefined;
  return <SettingsSection title="Live playback relay" description="Helps devices connect to a shared screen or sound. Changes apply when sharing starts again.">
    <SettingsRow label={`Run relay on ${couch}`} description={localStatus && <span role="status">{localStatus}</span>}>
      <Switch aria-label={`Run relay on ${couch}`} checked={toggle.isPending ? toggle.variables : local.data?.enabled ?? false} disabled={!connected || local.isPending || local.isError || toggle.isPending || check.isPending} onCheckedChange={enabled => toggle.mutate(enabled)} />
    </SettingsRow>
    {local.data?.error && <Alert variant="destructive"><AlertDescription>{local.data.error}</AlertDescription></Alert>}
    {local.data?.enabled && <>
      <SettingsRow label="Check from this device" description={`Tests whether ${host ? "this device" : device} can reach the relay. Test playback on the receiving device too.`}>
        <Button variant="outline" disabled={!connected || !local.data.relay || check.isPending} onClick={() => check.mutate(local.data!.relay!)}>{check.isPending ? "Checking…" : "Check relay"}</Button>
      </SettingsRow>
    </>}
    {(local.error || toggle.error) && <Alert variant="destructive"><AlertDescription>{local.error?.message ?? toggle.error?.message}</AlertDescription>{local.isError && <AlertAction><Button variant="outline" onClick={() => void local.refetch()}>Try again</Button></AlertAction>}</Alert>}
    <Collapsible>
      <CollapsibleTrigger asChild><Button variant="ghost" className="group -ml-3.5">External relay settings<ChevronDown aria-hidden="true" className="size-4 group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger>
      <CollapsibleContent>
    <form onSubmit={submit}>
      <SettingsRow label="TURN address" htmlFor="live-relay-url" description={`Used when the built-in relay is off. Get a turn: or turns: address from your provider.${query.data?.source === "environment" ? " Using launch settings until you save or remove them here." : ""}`}>
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
        <Button type="button" variant="outline" disabled={busy || !!draft || !query.data?.relay || local.data?.enabled} onClick={() => check.mutate(query.data!.relay!)}>{check.isPending ? "Checking…" : "Check external relay"}</Button>
        <Button type="button" variant="ghost" disabled={busy || !query.data?.relay} onClick={() => { check.reset(); save.mutate(null); }}>Remove relay</Button>
      </div>
    </form>
      </CollapsibleContent>
    </Collapsible>
    {(query.error || save.error || check.error) && <Alert variant="destructive"><AlertDescription>{query.error?.message ?? save.error?.message ?? check.error?.message}{check.error && " Low-delay playback has not been verified."}</AlertDescription>{query.isError && <AlertAction><Button variant="outline" disabled={!connected} onClick={() => void query.refetch()}>Try again</Button></AlertAction>}</Alert>}
  </SettingsSection>;
}
