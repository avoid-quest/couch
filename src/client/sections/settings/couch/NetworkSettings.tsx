import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend, type ApiCredentials } from "@/api/client";
import { lanHttpQuery, originDomainQuery } from "@/api/settings";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ADMIN_ONLY } from "@/copy";
import { LiveRelaySettings } from "./LiveRelaySettings";

type Props = {
  credentials: ApiCredentials; connected: boolean; urls: string[]; remoteControlEnabled: boolean; managedLan: boolean; lanError?: string | null;
  /** This device and the Couch, by name; host is true when this device runs the Couch. */
  device: string; couch: string; host: boolean; administrator: boolean;
};

// Plain HTTP to another computer; the host's own window uses loopback, which never loses HTTP.
/** Keys Share on network's save so first-run setup can wait for it and read what it saved. */
export const sharingMutationKey = ["settings", "sharing"];

const overHttp = (origin: string) => { const url = new URL(origin); return url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname); };

/** How the Couch reaches the network: sharing, transports, its address and the live relay. Admins change it from any paired device. */
export function NetworkSettings({ credentials, connected, urls, remoteControlEnabled, managedLan, lanError, device, couch, host, administrator }: Props) {
  const queryClient = useQueryClient();
  const originDomain = useQuery({ ...originDomainQuery(credentials, urls), enabled: connected && administrator && managedLan });
  const lanHttp = useQuery({ ...lanHttpQuery(credentials), enabled: connected && managedLan });
  const [domainDraft, setDomainDraft] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"sharing" | "http" | null>(null);
  const savedDomain = originDomain.data?.domain || originDomain.data?.suggested || "";
  const domain = domainDraft ?? savedDomain;
  const port = urls[0] && new URL(urls[0]).port;
  // The server bumps the devices revision, which refreshes remoteControlEnabled.
  const sharing = useMutation({ mutationKey: sharingMutationKey, mutationFn: (enabled: boolean) => apiSend(credentials, "/api/settings/sharing", { enabled }) });
  const saveHttp = useMutation({
    mutationFn: (enabled: boolean) => apiSend<{ enabled: boolean }>(credentials, "/api/settings/http", { enabled }),
    onSuccess: result => queryClient.setQueryData(lanHttpQuery(credentials).queryKey, result),
  });
  const saveDomain = useMutation({
    mutationFn: (value: string) => apiSend<{ domain: string; suggested?: string }>(credentials, "/api/settings/origin-domain", { domain: value }),
    onSuccess: result => { queryClient.setQueryData(originDomainQuery(credentials, urls).queryKey, result); setDomainDraft(null); },
  });
  const message = (error: Error | null, fallback: string) => error ? error.message || fallback : null;
  const locked = (description: string) => administrator ? description : `${description} ${ADMIN_ONLY}`;
  const secureUrl = urls.find(url => url.startsWith("https:"));
  const changeSharing = (enabled: boolean) => { if (sharing.isPending) return; if (enabled) sharing.mutate(true); else setConfirm("sharing"); };
  const changeHttp = (enabled: boolean) => { if (saveHttp.isPending) return; if (enabled) saveHttp.mutate(true); else setConfirm("http"); };
  function submitDomain(event: FormEvent) {
    event.preventDefault();
    if (!saveDomain.isPending) saveDomain.mutate(domain.trim());
  }

  return <>
    <SettingsSection>
      <SettingsRow label="Share on network" description={locked("Phones, browsers and other computers on your network can pair and play.")}>
        <Switch aria-label="Share on network" checked={sharing.isPending ? sharing.variables : remoteControlEnabled} disabled={!administrator || !connected || sharing.isPending} onCheckedChange={changeSharing} />
      </SettingsRow>
      {managedLan && <SettingsRow label="Allow HTTP connections" description={locked("HTTPS is always available. Allow unencrypted HTTP for devices that cannot use HTTPS, only on a trusted network. Turning this off disconnects HTTP devices.")}>
        <Switch aria-label="Allow HTTP connections" checked={saveHttp.isPending ? saveHttp.variables : lanHttp.data?.enabled ?? false} disabled={!administrator || !connected || lanHttp.isPending || lanHttp.isError || saveHttp.isPending} onCheckedChange={changeHttp} />
      </SettingsRow>}
      {managedLan && (administrator ? <SettingsRow label="Network address" htmlFor="origin-domain" description={lanError || (originDomain.data?.suggested ? `Using ${couch}'s name on your network. Enter another address to customize it.` : `A DNS name for ${couch}, like couch.home.${port ? ` If port 80 is taken, add :${port}.` : ""}`)}>
        <form className="flex w-full flex-wrap items-center gap-2" onSubmit={submitDomain}>
          <Input id="origin-domain" className="min-w-0 flex-1" placeholder="couch.home" autoCapitalize="none" autoComplete="off" spellCheck={false} value={domain} onChange={event => setDomainDraft(event.target.value)} disabled={!connected || saveDomain.isPending || originDomain.isPending} />
          <Button type="submit" variant="outline" disabled={!connected || saveDomain.isPending || originDomain.isPending || domain.trim() === savedDomain}>{saveDomain.isPending ? "Saving…" : "Save"}</Button>
        </form>
      </SettingsRow> : <SettingsRow label="Network address" description={ADMIN_ONLY} />)}
      {managedLan && (saveHttp.error || lanHttp.error) && <Alert variant="destructive"><AlertDescription>{message(saveHttp.error, "Couldn't save HTTP connections.") ?? message(lanHttp.error, "Couldn't read HTTP connections.")}</AlertDescription>{lanHttp.error && <AlertAction><Button variant="outline" size="sm" disabled={!connected} onClick={() => void lanHttp.refetch()}>Try again</Button></AlertAction>}</Alert>}
      {sharing.error && <Alert variant="destructive"><AlertDescription>{message(sharing.error, "Couldn't change Share on network.")}</AlertDescription></Alert>}
      {(saveDomain.error || originDomain.error) && <Alert variant="destructive"><AlertDescription>{message(saveDomain.error, "Couldn't save the address.") ?? message(originDomain.error, "Couldn't read the address.")}</AlertDescription>{originDomain.error && !saveDomain.error && <AlertAction><Button variant="outline" size="sm" disabled={!connected} onClick={() => void originDomain.refetch()}>Try again</Button></AlertAction>}</Alert>}
    </SettingsSection>
    {administrator ? <LiveRelaySettings credentials={credentials} connected={connected} device={device} couch={couch} host={host} />
      : <SettingsSection title="Live playback relay" description={`A relay on ${couch} for devices that can't connect directly. ${ADMIN_ONLY}`} />}
    <AlertDialog open={!!confirm} onOpenChange={open => { if (!open) setConfirm(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm === "http" ? "Turn off HTTP connections?" : "Turn off Share on network?"}</AlertDialogTitle>
          <AlertDialogDescription>{confirm === "http" ? `Every device connected over HTTP disconnects now${overHttp(credentials.origin) ? `, including ${device}.${secureUrl ? ` Open ${secureUrl} to keep using ${couch}.` : ""}` : ". Devices using HTTPS stay connected."}`
            : host ? `Every paired device disconnects. What ${couch} plays keeps playing.` : `Every paired device disconnects, including ${device}, until someone turns this on at ${couch}.`}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => confirm === "http" ? saveHttp.mutate(false) : sharing.mutate(false)}>Turn off</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
