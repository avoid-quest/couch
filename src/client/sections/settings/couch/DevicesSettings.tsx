import { SettingsRowsSkeleton } from "@/components/LoadingMedia";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend, type ApiCredentials } from "@/api/client";
import { claimCodeQuery, devicesQuery } from "@/api/devices";
import { PairingDialog } from "@/components/PairingDialog";
import { RowOptions } from "@/components/RowMenu";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { TryAgain } from "@/components/TryAgain";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatSeen } from "@/time-format";
import { ChevronDown, Laptop, MonitorSmartphone, Smartphone, Tv } from "lucide-react";
import { staleDuplicates, type Device, type DeviceIdentity } from "../../../../shared/devices";
import { cn } from "@/lib/utils";
import { RenameCouch } from "./RenameCouch";

/** A device's name after its glyph where its kind is known: a TV, the computer that runs Couch, this device; others are a phone or computer. */
function DeviceName({
  kind,
  online,
  children,
}: {
  kind: "tv" | "computer" | "phone" | null;
  online: boolean;
  children: ReactNode;
}) {
  const Icon =
    kind === "tv"
      ? Tv
      : kind === "computer"
        ? Laptop
        : kind === "phone"
          ? Smartphone
          : MonitorSmartphone;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon
        aria-hidden="true"
        className={cn("size-4 shrink-0", !online && "text-muted-foreground")}
      />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </span>
  );
}

export function DevicesSettings({
  credentials,
  connected,
  urls,
  identity,
  remoteControlEnabled,
  administratorClaimed,
  hostName = "Couch",
  online = new Set(),
  tvs = new Set(),
  hostTv = false,
  children,
  pairing,
  onPairingShown,
}: {
  credentials: ApiCredentials;
  connected: boolean;
  urls: string[];
  identity: DeviceIdentity;
  remoteControlEnabled: boolean;
  administratorClaimed: boolean;
  hostName?: string;
  /** Devices connected now, from the session state. */
  online?: ReadonlySet<string>;
  /** Devices known to be TVs, and whether the host is one. */
  tvs?: ReadonlySet<string>;
  hostTv?: boolean;
  /** The Couch's network settings, between pairing and the devices. */
  children?: ReactNode;
  /** Asked to show the pairing code, once. */
  pairing: boolean;
  onPairingShown: () => void;
}) {
  const queryClient = useQueryClient();
  const selfId = identity.device?.id;
  const host = identity.authority === "host";
  const manager = identity.authority === "administrator" || host;
  const devices = useQuery({ ...devicesQuery(credentials), enabled: connected });
  // The first device paired becomes the admin, so the admin code is useful only once devices are paired.
  const paired = devices.data?.some((device) => device.role !== "host");
  const setupCode = useQuery({
    ...claimCodeQuery(credentials),
    enabled: connected && remoteControlEnabled && host && !administratorClaimed && !!paired,
  });
  const [code, setCode] = useState("");
  const [pairingOpen, setPairingOpen] = useState(false);
  const [removing, setRemoving] = useState<Device[]>([]);
  const [showOld, setShowOld] = useState(false);
  const pairingRef = useRef<HTMLButtonElement>(null);
  const pairUrl = urls[0];
  useEffect(() => {
    if (!pairing) return;
    setPairingOpen(true);
    onPairingShown();
  }, [pairing]);
  const refreshDevices = () =>
    queryClient.invalidateQueries({ queryKey: devicesQuery(credentials).queryKey });
  const claiming = useMutation({
    mutationFn: (value: string) => apiSend(credentials, "/api/devices/claim", { code: value }),
    onSuccess: refreshDevices,
  });
  const deviceChange = useMutation({
    mutationFn: async ({ targets, action }: { targets: Device[]; action: "role" | "remove" }) => {
      for (const target of targets)
        await (action === "role"
          ? apiSend(credentials, `/api/devices/${target.id}/role`, {
              role: target.role === "administrator" ? "controller" : "administrator",
            })
          : apiSend(credentials, `/api/devices/${target.id}`, undefined, "DELETE"));
    },
    onSettled: refreshDevices,
  });
  const message = (error: Error | null, fallback: string) =>
    error ? error.message || fallback : null;
  const pending = deviceChange.isPending;
  const act = (targets: Device[], action: "role" | "remove") => {
    if (!pending && targets.length) deviceChange.mutate({ targets, action });
  };
  const isOnline = (device: Device) => online.has(device.id);
  const stale = staleDuplicates(devices.data ?? [], online, selfId);
  const kind = (device: Device) =>
    tvs.has(device.id) || (device.role === "host" && hostTv)
      ? ("tv" as const)
      : device.role === "host"
        ? ("computer" as const)
        : device.id === selfId
          ? matchMedia("(pointer: coarse)").matches
            ? ("phone" as const)
            : ("computer" as const)
          : null;
  function claim(event: FormEvent) {
    event.preventDefault();
    if (!claiming.isPending) claiming.mutate(code.trim());
  }

  // This device and the host lead, then what's online, then the rest by when each was last seen. A device not seen for a
  // week folds under "Not seen lately", so old pairings never push the list past the page.
  const now = Date.now();
  const rank = (device: Device) =>
    device.id === selfId || device.role === "host" ? 0 : isOnline(device) ? 1 : 2;
  const sorted = [...(devices.data ?? [])].sort(
    (a, b) => rank(a) - rank(b) || (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0),
  );
  const old = (device: Device) =>
    rank(device) === 2 && (!device.lastSeenAt || now - device.lastSeenAt > 7 * 86_400_000);
  const recent = sorted.filter((device) => !old(device));
  const folded = sorted.filter(old);
  // One quiet line in plain words: "This device, admin", "Hosts Couch", "Admin, online", "Seen yesterday".
  const status = (device: Device) => {
    const line =
      device.role === "host"
        ? [device.id === selfId ? "This device, hosts Couch" : "Hosts Couch"]
        : device.id === selfId
          ? ["This device", device.role === "administrator" && "admin"]
          : [
              device.role === "administrator" && "admin",
              isOnline(device)
                ? "online"
                : device.lastSeenAt
                  ? `seen ${formatSeen(device.lastSeenAt, now)}`
                  : "never seen",
              stale.includes(device) && "older duplicate",
            ];
    const text = line.filter(Boolean).join(", ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  const row = (device: Device) => (
    <SettingsRow
      key={device.id}
      data-device={device.id}
      data-stale={stale.includes(device) || undefined}
      label={
        <DeviceName kind={kind(device)} online={device.role === "host" || isOnline(device)}>
          {device.name}
        </DeviceName>
      }
      description={status(device)}
    >
      {/* A left-behind duplicate offers only Forget. */}
      {manager && device.role !== "host" && device.id !== selfId && (
        <RowOptions
          title={device.name}
          disabled={pending}
          actions={[
            ...(stale.includes(device)
              ? []
              : [
                  {
                    label: device.role === "administrator" ? "Remove admin" : "Make admin",
                    group: "role",
                    run: () => act([device], "role"),
                  },
                ]),
            // Destructive, so last and apart; it confirms.
            { label: "Forget", group: "forget", run: () => setRemoving([device]) },
          ]}
        />
      )}
    </SettingsRow>
  );

  // The Couch's own settings lead: its name, pairing, the network, the rare admin handover; its Devices close the page.
  return (
    <>
      <SettingsSection data-devices>
        {!host && manager && (
          <SettingsRow label="Name" description="This Couch's name on every device.">
            <span className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {hostName}
            </span>
            <RenameCouch
              credentials={credentials}
              connected={connected}
              name={hostName}
              onRenamed={refreshDevices}
            />
          </SettingsRow>
        )}
        <SettingsRow
          label="New device"
          description={
            !manager
              ? "Only an admin can pair devices."
              : !remoteControlEnabled
                ? "Turn on Share on network below first."
                : `Show a code to scan or type on the new device.${host && !administratorClaimed && paired === false ? " The first device you pair becomes the admin." : ""}`
          }
        >
          {manager && (
            <Button
              ref={pairingRef}
              data-page-first
              variant="outline"
              disabled={!connected || !pairUrl || !remoteControlEnabled}
              onClick={() => setPairingOpen(true)}
            >
              Pair a device
            </Button>
          )}
        </SettingsRow>
        {manager && (
          <PairingDialog
            credentials={credentials}
            urls={urls}
            connected={connected}
            open={pairingOpen && remoteControlEnabled}
            onOpenChange={setPairingOpen}
            openerRef={pairingRef}
          />
        )}
      </SettingsSection>
      {children}
      {host && remoteControlEnabled && !administratorClaimed && paired && (
        <SettingsSection
          title="Make a device the admin"
          description="Enter this one-time code on a paired device."
          data-administrator-setup
        >
          <div className="flex min-w-0 flex-col gap-1">
            {setupCode.isPending ? (
              <SettingsRowsSkeleton />
            ) : setupCode.isError || !setupCode.data || !pairUrl ? (
              <Alert variant="destructive">
                <AlertDescription>Couldn't load the admin code.</AlertDescription>
                <AlertAction>
                  <TryAgain
                    disabled={!connected || setupCode.isFetching}
                    onClick={() => void setupCode.refetch()}
                  />
                </AlertAction>
              </Alert>
            ) : (
              <>
                <p
                  className="font-display text-5xl font-semibold break-all tabular-nums"
                  data-administrator-code
                >
                  {setupCode.data.code}
                </p>
                <a
                  data-text-link
                  className="break-all text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  href={pairUrl}
                >
                  {pairUrl}
                </a>
              </>
            )}
          </div>
        </SettingsSection>
      )}
      {identity.authority === "controller" && identity.claimAvailable && (
        <SettingsSection data-admin-claim>
          <SettingsRow
            label="Admin code"
            htmlFor="administrator-code"
            description={`Shown on ${hostName} in Settings → Devices & network.`}
          >
            <form className="flex w-full flex-wrap items-center gap-2" onSubmit={claim}>
              <Input
                id="administrator-code"
                className="min-w-0 flex-1"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                pattern="[0-9]{10}|[a-fA-F0-9]{32,256}"
                maxLength={256}
                required
                disabled={claiming.isPending}
              />
              <Button
                type="submit"
                disabled={claiming.isPending || !/^(?:\d{10}|[a-f\d]{32,256})$/i.test(code.trim())}
              >
                {claiming.isPending ? "Checking…" : "Become admin"}
              </Button>
            </form>
          </SettingsRow>
          {claiming.error && (
            <Alert variant="destructive">
              <AlertDescription>
                {message(claiming.error, "Couldn't make you admin. Check the code.")}
              </AlertDescription>
            </Alert>
          )}
        </SettingsSection>
      )}
      <SettingsSection title="Devices">
        {devices.isPending ? (
          <SettingsRowsSkeleton />
        ) : devices.isError ? (
          <Alert variant="destructive">
            <AlertDescription>Couldn't load devices.</AlertDescription>
            <AlertAction>
              <TryAgain onClick={() => void devices.refetch()} />
            </AlertAction>
          </Alert>
        ) : !devices.data.length ? (
          <Empty className="py-0">
            <EmptyHeader>
              <EmptyDescription>No devices yet. Use Pair a device to connect one.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {recent.map(row)}
            {folded.length > 0 && (
              <SettingsRow
                label={`Not seen lately (${folded.length})`}
                description="Offline for more than a week."
              >
                <Button
                  variant="ghost"
                  aria-expanded={showOld}
                  onClick={() => setShowOld(!showOld)}
                >
                  {showOld ? "Hide" : "Show"}
                  <ChevronDown aria-hidden="true" className={cn(showOld && "rotate-180")} />
                </Button>
              </SettingsRow>
            )}
            {showOld && folded.map(row)}
            {manager && stale.length > 1 && (
              <SettingsRow
                label="Older duplicates"
                description={`${stale.length} offline devices share a name with a newer one.`}
              >
                <Button variant="outline" disabled={pending} onClick={() => setRemoving(stale)}>
                  Forget all
                </Button>
              </SettingsRow>
            )}
          </>
        )}
        {deviceChange.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {message(deviceChange.error, "Couldn't update the device. Try again.")}
            </AlertDescription>
          </Alert>
        )}
      </SettingsSection>
      <AlertDialog
        open={removing.length > 0}
        onOpenChange={(open) => {
          if (!open) setRemoving([]);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removing.length > 1
                ? `Forget ${removing.length} older duplicates?`
                : `Forget ${removing[0]?.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removing.length > 1
                ? "They will need to pair again."
                : "It will need to pair again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => act(removing, "remove")}>
              Forget
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
