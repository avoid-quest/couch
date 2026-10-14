import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend, type ApiCredentials } from "@/api/client";
import { liveRelayQuery } from "@/api/settings";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkLiveRelay } from "@/session/check-live-relay";
import type { LiveRelay, LiveRelaySettings as RelaySettings } from "../../../../shared/live-relay";

const emptyRelay: LiveRelay = { urls: "", username: "", credential: "" };

export function LiveRelaySettings({ credentials, connected }: { credentials: ApiCredentials; connected: boolean }) {
  const client = useQueryClient();
  const query = useQuery({ ...liveRelayQuery(credentials), enabled: connected });
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
    onSuccess: () => setStatus("Relay reachable from this computer. Test playback on the receiving device too."),
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
  return <SettingsSection title="Live playback relay" description="If a shared screen or sound plays Buffered with a long delay, an existing TURN relay can keep it interactive. Enter the address and credentials from your relay provider or network administrator. Couch does not create a relay.">
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
        <Button type="button" variant="outline" disabled={busy || !!draft || !query.data?.relay} onClick={() => { setStatus(""); check.mutate(query.data!.relay!); }}>{check.isPending ? "Checking…" : "Check saved relay"}</Button>
        <Button type="button" variant="ghost" disabled={busy || !query.data?.relay} onClick={() => { check.reset(); setStatus(""); save.mutate(null); }}>Remove relay</Button>
      </div>
    </form>
    {query.data?.source === "environment" && <p className="text-sm text-muted-foreground">Using launch settings. Saving or removing a relay here overrides them, including after restarting Couch.</p>}
    {status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
    {(query.error || save.error || check.error) && <Alert variant="destructive"><AlertDescription>{query.error?.message ?? save.error?.message ?? check.error?.message}{check.error && " The relay is saved, but low-delay playback has not been verified."}</AlertDescription></Alert>}
    {query.isError && <Button variant="outline" disabled={!connected} onClick={() => void query.refetch()}>Try again</Button>}
  </SettingsSection>;
}
