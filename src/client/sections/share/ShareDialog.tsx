import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, ExternalLink, RefreshCw, Search, X } from "lucide-react";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { deviceId, useLocalDeviceName } from "@/session/device-id";
import { couchApp } from "@/session/native-context";
import { useNativeInputBufferPreference, useNativeInputChannelPreference } from "@/audio-settings";
import { errorText, useSessionGate } from "@/session/session-context";
import { isDesktop, subscribeDesktop } from "@/sections/shell/Outputs";
import { CaptureBufferSelect } from "./LiveOperator";
import { InputLevel, useInputStream } from "./InputLevel";
import {
  nativeInputChannelMap,
  nativeInputChannelOptions,
  nativeInputChannelPreference,
} from "../../../shared/audio-settings";
import { selectionOf, shareKinds, unavailable, type ShareKind } from "./share";
import { answeredShare, useShareView } from "./share-view";
import type { AudioInput, CaptureSource } from "../../../shared/capture";
import {
  defaultLiveFrameRate,
  type LiveMetadata,
  type LiveVideoFrameRate,
  type LiveVideoQuality,
} from "../../../shared/live-input";
import { LiveMetadataFields } from "./LiveMetadata";

// A chip: a quiet capsule that steps up under the pointer, the chosen one checked (Search's kinds do the same). A kind
// this device can't share keeps its place at half ink.
const chip =
  "h-control flex-none gap-1.5 rounded-full bg-secondary px-3.5 font-normal hover:bg-fill-hover data-[state=on]:bg-foreground data-[state=on]:text-background data-[unavailable]:opacity-50 touch:h-11";

/** One label, with what it means under it, beside its control. */
function Row({
  label,
  htmlFor,
  description,
  children,
}: {
  label: string;
  htmlFor?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-control flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <div className="grid max-w-64 gap-0.5">
        <label htmlFor={htmlFor} className="text-body">
          {label}
        </label>
        {description && <p className="text-meta text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * Share (docs/live-inputs.md): a button that opens the Share panel from itself, a Popover on desktops and the TV and a
 * Sheet rising from below on phones. The panel says what to share and how, and Start sharing starts it: it waits in
 * Shared sources for people to play or join, and the player shows it here. `header`: Share again opens this one.
 */
export function ShareButton({
  className,
  tv,
  header = false,
  children,
}: {
  className?: string;
  tv: boolean;
  header?: boolean;
  children: ReactNode;
}) {
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => false);
  const { ask } = useShareView();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string | undefined>();
  // Share again, from the message that the capture ended: the panel opens on the kind that was shared. The request
  // stands until the panel closes, since it alone keeps Share in a header that hides it (a TV's).
  useEffect(() => {
    if (!header || !ask) return;
    setKind(ask.kind);
    setOpen(true);
  }, [header, ask?.at]);
  useEffect(() => () => void (header && answeredShare()), [header]);
  const change = (next: boolean) => {
    setOpen(next);
    if (next) return;
    setKind(undefined);
    if (header) answeredShare();
  };
  const name = useLocalDeviceName();
  const title = name ? `Share from ${name}` : "Share this device";
  const button = (
    <Button
      data-tv-local-only
      variant="secondary"
      className={className}
      aria-label="Share screen or sound"
      title="Share screen or sound"
    >
      {children}
    </Button>
  );
  // Its choices reset each time it opens, and capture is asked for only from the device in hand.
  const body = open && (
    <ShareForm
      title={title}
      initialKind={kind}
      onDone={() => change(false)}
      sheet={!desktop && !tv}
    />
  );
  if (desktop || tv)
    return (
      <Popover open={open} onOpenChange={change}>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
        <PopoverContent
          data-tv-local-only
          align="end"
          collisionPadding={12}
          aria-label={title}
          className="max-h-(--radix-popover-content-available-height) w-[min(34rem,calc(100vw-1.5rem))] gap-0 overflow-y-auto p-0"
        >
          {body}
        </PopoverContent>
      </Popover>
    );
  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetTrigger asChild>{button}</SheetTrigger>
      <SheetContent
        data-tv-local-only
        side="bottom"
        aria-describedby={undefined}
        showCloseButton={false}
        className="max-h-[90dvh] items-center gap-0 overflow-y-auto p-0"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <div className="grid w-full max-w-2xl">{body}</div>
      </SheetContent>
    </Sheet>
  );
}

function ShareForm({
  title,
  initialKind,
  onDone,
  sheet,
}: {
  title: string;
  initialKind?: string;
  onDone: () => void;
  sheet: boolean;
}) {
  const {
    state,
    connected,
    localHost,
    startLive,
    endLive,
    liveAudioInputs,
    liveSharing,
    setError: report,
  } = useSessionGate();
  const here = deviceId();
  const systemAudio = couchApp?.systemAudioCapture !== false;
  const kinds = shareKinds.filter(
    (item) => !item.intent && (item.capture !== "system-audio" || systemAudio),
  );
  const browser = {
    media: !!navigator.mediaDevices?.getUserMedia,
    display: !!navigator.mediaDevices?.getDisplayMedia,
  };
  // Share again after Live opens on the choice it was made from (Audio input, System audio), still Live.
  const initial = shareKinds.find((item) => item.id === initialKind);
  const [picked, setPicked] = useState<ShareKind>(
    () =>
      kinds.find(
        (item) =>
          (initial?.intent ? item.capture === initial.capture : item === initial) &&
          !unavailable(item, browser),
      ) ??
      kinds.find((item) => !unavailable(item, browser)) ??
      kinds[0]!,
  );
  // Pressing a kind this device can't share says why, under the kinds.
  const [why, setWhy] = useState<string | null>(null);
  const [systemLive, setSystemLive] = useState(initialKind === "live-sound");
  // On the Couch computer an audio input is always Live, and System audio is Live when chosen (architecture §1.4).
  const kind =
    (localHost &&
      (picked.inputs || (picked.capture === "system-audio" && systemLive)) &&
      shareKinds.find((item) => item.intent === "live" && item.capture === picked.capture)) ||
    picked;
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [inputs, setInputs] = useState<AudioInput[] | null>(null);
  const [audioDeviceId, setAudioDeviceId] = useState("default");
  const nativeBuffer = useNativeInputBufferPreference(),
    nativeChannels = useNativeInputChannelPreference();
  const inputChannels =
    kind.intent === "live"
      ? inputs?.find((input) => input.deviceId === audioDeviceId)?.nativeChannels
      : undefined;
  const channelPreference = nativeInputChannelPreference(nativeChannels.value, inputChannels ?? 2);
  useEffect(() => {
    setInputs(null);
    setAudioDeviceId(kind.intent === "live" ? "" : "default");
  }, [kind.id]);
  const [sound, setSound] = useState(systemAudio);
  const [quality, setQuality] = useState<LiveVideoQuality>("1080p");
  const [metadata, setMetadata] = useState<LiveMetadata>({});
  const [frameRate, setFrameRate] = useState<LiveVideoFrameRate>(defaultLiveFrameRate);
  const [pending, setPending] = useState(false);
  const [listing, setListing] = useState(false);
  // A problem finding what to share, said where it would be.
  const [error, setError] = useState<string | null>(null);
  // What to turn on in the system's settings, once capturing failed without it, for the kind it failed on.
  const [blocked, setBlocked] = useState<{ kind: string; text: string } | null>(null);
  const reason = unavailable(kind, browser);
  const lists = !!couchApp?.captureSources && kind.capture !== "microphone";
  const pictures = kind.pictures && sources?.filter((source) => source.kind === kind.pictures);
  const source = pictures?.find((item) => item.id === sourceId);
  // Another window of this device already shares; Core keeps one source per capturing window.
  const elsewhere = state?.liveSources?.find((item) => item.deviceId === here);
  const available = connected && !pending && !listing;
  // Closing the panel while the capture or the input probe starts cancels it, as Cancel does. Once published, the
  // header's pill takes Share's place and unmounts the panel itself, which ends nothing.
  const starting = useRef(false);
  useEffect(
    () => () => {
      if (starting.current && !liveSharing.current()) void endLive().catch(() => {});
    },
    [],
  );
  const access = blocked?.kind === kind.id ? blocked : null;
  const needsInput =
    kind.intent === "live" && !!kind.inputs && (!audioDeviceId || audioDeviceId === "default");
  const needsPicture =
    lists && !(kind.pictures ? source : sources?.some((item) => item.kind === "screen"));
  // The desktop app's System audio takes a screen's capture for its sound (selectionOf).
  const ready = available && !reason && !elsewhere && !access && !needsInput && !needsPicture;

  const checkAccess = async (on = kind) => {
    const text = await couchApp?.captureAccess?.(on.capture).catch(() => null);
    setBlocked(text ? { kind: on.id, text } : null);
  };
  const list = async () => {
    if (!couchApp?.captureSources || listing || pending) return;
    setListing(true);
    setError(null);
    try {
      const next = await couchApp.captureSources();
      setSources(next);
      setSourceId((previous) => (next.some((source) => source.id === previous) ? previous : ""));
      if (!next.length) await checkAccess();
    } catch (reason) {
      setError(errorText(reason));
      await checkAccess();
    } finally {
      setListing(false);
    }
  };
  // The desktop app lists its screens and windows as it opens, and again on returning from the system's settings.
  useEffect(() => {
    if (lists) void list();
  }, [lists]);
  useEffect(() => {
    if (!blocked) return;
    const recheck = () => {
      void checkAccess().then(() => {
        if (lists) void list();
      });
    };
    addEventListener("focus", recheck);
    return () => removeEventListener("focus", recheck);
  }, [blocked, kind]);
  // A screen is chosen for you while there is one; a window waits for your choice.
  useEffect(() => {
    if (kind.pictures === "screen" && pictures?.length && !source) setSourceId(pictures[0]!.id);
  }, [kind, sources]);

  const chooseInput = async () => {
    setListing(true);
    setError(null);
    try {
      starting.current = true;
      const next = await liveAudioInputs(kind.intent === "live").finally(() => {
        starting.current = false;
      });
      setInputs(next);
      setAudioDeviceId((previous) =>
        next.some((input) => input.deviceId === previous)
          ? previous
          : kind.intent === "live"
            ? (next.find((input) => input.deviceId !== "default")?.deviceId ?? "")
            : "default",
      );
      if (!next.length)
        setError(
          "No audio inputs are available. Connect a microphone or audio interface and try again.",
        );
    } catch (reason) {
      setError(errorText(reason));
      await checkAccess();
    } finally {
      setListing(false);
    }
  };
  // Start the capture; it waits in Shared sources and the player shows it here. A failure is a message.
  const share = async () => {
    if (!ready) return;
    setPending(true);
    setError(null);
    try {
      starting.current = true;
      await startLive({
        ...selectionOf(kind, {
          source,
          sources: sources ?? undefined,
          audioDeviceId,
          quality,
          frameRate,
          sound,
        }),
        ...(kind.intent === "live" ? { metadata } : {}),
        ...(audioDeviceId.startsWith("native:")
          ? { meterId: inputs?.find((input) => input.deviceId === audioDeviceId)?.meterId }
          : {}),
        ...(inputChannels && inputChannels > 2
          ? { nativeChannelMap: nativeInputChannelMap(channelPreference) }
          : {}),
      }).finally(() => {
        starting.current = false;
      });
      onDone();
    } catch (reason) {
      await checkAccess();
      report(`Couldn't start sharing. ${errorText(reason)}`);
    } finally {
      setPending(false);
    }
  };

  // The line beside Start sharing: what happens, or what's missing first.
  const line: [string, string?] = pending
    ? ["Starting…"]
    : elsewhere
      ? [`Already sharing ${elsewhere.name} from another window`, "Stop sharing there first."]
      : reason
        ? [reason]
        : access
          ? [
              kind.pictures
                ? "Couch can't see this computer's screens yet"
                : kind.inputs
                  ? "Couch can't hear this computer's inputs yet"
                  : "Couch can't hear this computer's sound yet",
            ]
          : needsPicture
            ? [kind.pictures === "window" ? "Choose a window" : "Choose a screen"]
            : needsInput
              ? ["Choose an audio input"]
              : kind.intent === "live"
                ? [
                    "People join from Home, under Shared sources",
                    "Each listens on their own device, at their own volume.",
                  ]
                : ["It waits in Shared sources", "Anyone on this Couch can play it from Home."];

  const thing = access ? (
    <div className="grid justify-items-start gap-2 py-2">
      <p className="text-body font-medium">
        {kind.pictures
          ? "Couch can't see your screens and windows"
          : kind.inputs
            ? "Couch can't hear your audio inputs"
            : "Couch can't hear this computer's sound"}
      </p>
      <p className="text-meta text-muted-foreground">{access.text}</p>
      {couchApp?.openCaptureSettings && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="rounded-full"
          onClick={() =>
            void couchApp
              ?.openCaptureSettings?.(kind.capture)
              .catch((reason) => setError(errorText(reason)))
          }
        >
          <ExternalLink aria-hidden="true" />
          Open System Settings
        </Button>
      )}
    </div>
  ) : lists && kind.pictures ? (
    <>
      <Pictures
        sources={pictures}
        listing={listing}
        value={sourceId}
        onValueChange={setSourceId}
        disabled={!available}
        kind={kind}
      />
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2.5 justify-self-start"
        disabled={!available}
        onClick={() => void list()}
      >
        {listing ? <Spinner aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
        Refresh {kind.pictures === "window" ? "windows" : "screens"}
      </Button>
    </>
  ) : kind.inputs ? (
    <Inputs
      live={kind.intent === "live"}
      inputs={inputs}
      value={audioDeviceId}
      onValueChange={setAudioDeviceId}
      listing={listing}
      disabled={!available || !!reason}
      onFind={() => void chooseInput()}
    />
  ) : (
    <p className="text-meta text-muted-foreground">
      {kind.capture === "system-audio"
        ? couchApp?.captureSources
          ? "Everything this computer plays goes out, without its picture: a music app, a browser tab, a game."
          : "Choose a tab or screen and turn on its audio in your browser's picker. Only sound is shared."
        : kind.pictures === "window"
          ? "Your browser asks which window to share."
          : "Your browser asks which screen to share."}
    </p>
  );

  return (
    <form
      className="grid min-w-0"
      onSubmit={(event) => {
        event.preventDefault();
        void share();
      }}
    >
      <div className="grid gap-4 px-4 pt-3 pb-4 max-sm:px-(--gutter)">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate font-display text-heading">{title}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="-mr-2"
            aria-label="Close"
            title="Close"
            onClick={onDone}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="grid gap-2">
          <ToggleGroup
            type="single"
            aria-label="What to share"
            spacing={2}
            className="w-full flex-wrap"
            value={picked.id}
            disabled={pending || listing}
            onValueChange={(value) => {
              const next = kinds.find((item) => item.id === value);
              if (!next) return;
              const cannot = unavailable(next, browser);
              setWhy(cannot ?? null);
              if (cannot) return;
              setPicked(next);
              setError(null);
              setSourceId("");
            }}
          >
            {kinds.map((item) => (
              <ToggleGroupItem
                key={item.id}
                value={item.id}
                className={chip}
                data-unavailable={unavailable(item, browser) ? "" : undefined}
                aria-disabled={unavailable(item, browser) ? true : undefined}
                title={unavailable(item, browser)}
              >
                {item === picked ? <Check aria-hidden="true" /> : <item.icon aria-hidden="true" />}
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {why && (
            <p role="status" className="text-meta text-muted-foreground">
              {why}
            </p>
          )}
        </div>
        {thing}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {kind.capture === "system-audio" && localHost && (
          <Row
            label="Playback"
            description={
              kind.intent === "live"
                ? "Live: people join for themselves, each at their own volume, close to live."
                : "Relaxed: the room shares one Playback, with Pause and the Mixer."
            }
          >
            <ChoiceGroup
              label="System audio playback"
              variant="segmented"
              value={kind.intent ?? "relaxed"}
              disabled={!available || !!reason}
              options={[
                { value: "relaxed", label: "Relaxed" },
                { value: "live", label: "Live" },
              ]}
              onValueChange={(value) => setSystemLive(value === "live")}
            />
          </Row>
        )}
        {!!inputChannels && inputChannels > 2 && (
          <Row label="Input channels">
            <ChoiceGroup
              label="Input channels"
              variant="segmented"
              value={channelPreference}
              disabled={!available}
              onValueChange={nativeChannels.save}
              options={nativeInputChannelOptions(inputChannels).map((value) => ({
                value,
                label: value.includes("/") ? value : `${value} mono`,
              }))}
            />
          </Row>
        )}
        {!!inputChannels && (
          <Row label="Capture buffer" htmlFor="share-capture-buffer">
            <CaptureBufferSelect
              id="share-capture-buffer"
              value={nativeBuffer.value}
              disabled={!available}
              onValueChange={nativeBuffer.save}
            />
          </Row>
        )}
        {!!inputChannels && (nativeBuffer.error || nativeChannels.error) && (
          <Alert variant="destructive">
            <AlertDescription>{nativeBuffer.error || nativeChannels.error}</AlertDescription>
          </Alert>
        )}
        {kind.intent === "live" && (
          <>
            <p className="text-meta text-muted-foreground">
              On this computer {kind.inputs ? "an input" : "its sound"} goes out as Live audio.
              People join for themselves, on their phones or any speaker, and set their own volume.
              No Pause, no Up next.
            </p>
            <LiveMetadataFields value={metadata} onChange={setMetadata} disabled={!available} />
          </>
        )}
        {kind.pictures && (
          <>
            <Row
              label={couchApp?.captureSources ? "Include system audio" : "Include audio"}
              htmlFor="live-include-audio"
              description={
                !systemAudio
                  ? "This desktop app can't share system audio. Share without sound or choose an audio input."
                  : couchApp?.captureSources
                    ? "Everything this computer plays, even when sharing one window."
                    : "Turn on audio in the browser's picker when offered."
              }
            >
              <Switch
                id="live-include-audio"
                checked={sound}
                disabled={pending || !systemAudio}
                onCheckedChange={setSound}
              />
            </Row>
            <Row label="Picture">
              <ChoiceGroup
                label="Picture"
                variant="segmented"
                value={quality}
                disabled={pending}
                onValueChange={setQuality}
                options={[
                  { value: "720p", label: "720p" },
                  { value: "1080p", label: "1080p" },
                  { value: "original", label: "Original" },
                ]}
              />
            </Row>
            <Row label="Frame rate" description="At most; your screen may give fewer.">
              <ChoiceGroup
                label="Frame rate"
                variant="segmented"
                value={String(frameRate) as `${LiveVideoFrameRate}`}
                disabled={pending}
                onValueChange={(value) => setFrameRate(Number(value) as LiveVideoFrameRate)}
                options={[
                  { value: "30", label: "30" },
                  { value: "60", label: "60" },
                  { value: "120", label: "120" },
                ]}
              />
            </Row>
          </>
        )}
      </div>
      {/* Start sharing and the line that says what happens stay in reach at the panel's foot. */}
      <div
        className={cn(
          "sticky bottom-0 flex items-center gap-3 border-t bg-popover px-4 py-3 max-sm:px-(--gutter)",
          sheet && "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        )}
      >
        <Button type="submit" className="shrink-0 rounded-full" disabled={!ready}>
          {pending && <Spinner />}
          Start sharing
        </Button>
        <p role="status" className="grid min-w-0 flex-1 text-meta">
          <span className="font-medium">{line[0]}</span>
          {line[1] && <span className="text-muted-foreground">{line[1]}</span>}
        </p>
        <Button type="button" variant="ghost" className="shrink-0" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * The audio inputs to choose from, the chosen one with its level, so the right one can be seen alive before it goes
 * out. A browser names its inputs only once allowed to use them, so until then it uses the system's default.
 */
function Inputs({
  live,
  inputs,
  value,
  onValueChange,
  listing,
  disabled,
  onFind,
}: {
  live: boolean;
  inputs: AudioInput[] | null;
  value: string;
  onValueChange: (value: string) => void;
  listing: boolean;
  disabled: boolean;
  onFind: () => void;
}) {
  // A native input's level is read from the same device as the browser names it.
  const chosen = inputs?.find((input) => input.deviceId === value);
  const stream = useInputStream(
    !inputs ? null : value.startsWith("native:") ? (chosen?.meterId ?? null) : value,
  );
  const named = inputs?.filter((input) => input.deviceId !== "default") ?? [];
  return (
    <div className="grid gap-2">
      <p className="text-body font-medium">Device</p>
      {!inputs ? (
        <p className="text-meta text-muted-foreground">
          {live
            ? "Find this computer's inputs to choose the one that carries the sound."
            : "System default is chosen. To pick another input, let the browser name them."}
        </p>
      ) : (
        <ToggleGroup
          type="single"
          aria-label="Audio input"
          orientation="vertical"
          spacing={2}
          value={value}
          disabled={disabled}
          onValueChange={(next) => {
            if (next) onValueChange(next);
          }}
          className="grid w-full"
        >
          {[...(live ? [] : [{ deviceId: "default", label: "System default" }]), ...named].map(
            (input, index) => (
              <ToggleGroupItem
                key={input.deviceId}
                value={input.deviceId}
                className="h-auto min-h-control w-full flex-col items-stretch justify-start gap-1.5 rounded-xl bg-secondary px-3 py-2 text-left font-normal whitespace-normal data-[state=on]:bg-secondary data-[state=on]:shadow-[inset_0_0_0_1.5px_var(--foreground)]"
              >
                <span className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded-full border border-foreground/60",
                      input.deviceId === value && "border-foreground",
                    )}
                  >
                    {input.deviceId === value && (
                      <span className="size-2 rounded-full bg-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {input.label || `Audio input ${index + 1}`}
                  </span>
                  {"nativeChannels" in input && input.nativeChannels && (
                    <span className="ml-auto shrink-0 text-meta text-muted-foreground">
                      {input.nativeChannels} inputs
                    </span>
                  )}
                </span>
                {input.deviceId === value && stream && (
                  <InputLevel stream={stream} className="ml-6.5" />
                )}
              </ToggleGroupItem>
            ),
          )}
        </ToggleGroup>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="justify-self-start rounded-full"
        disabled={disabled || listing}
        onClick={onFind}
      >
        {listing ? <Spinner aria-hidden="true" /> : <Search aria-hidden="true" />}
        {listing ? "Finding inputs…" : inputs ? "Refresh inputs" : "Find audio inputs"}
      </Button>
    </div>
  );
}

/**
 * The screens or windows to choose from, as small pictures with their names (the desktop app shows them for its own
 * Couch only); another Couch's page lists their names alone.
 */
function Pictures({
  sources,
  listing,
  value,
  onValueChange,
  disabled,
  kind,
}: {
  sources?: CaptureSource[] | false;
  listing: boolean;
  value: string;
  onValueChange: (value: string) => void;
  disabled: boolean;
  kind: ShareKind;
}) {
  const label = kind.pictures === "window" ? "Windows" : "Screens";
  if (!sources)
    return listing ? (
      <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner />
        Finding {label.toLowerCase()}…
      </p>
    ) : null;
  if (!sources.length)
    return <p className="py-6 text-sm text-muted-foreground">No {label.toLowerCase()} to share.</p>;
  if (!sources.some((source) => source.thumbnail))
    return (
      <ChoiceGroup
        label={label}
        orientation="vertical"
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        options={sources.map((source) => ({ value: source.id, label: source.name }))}
      />
    );
  return (
    <ToggleGroup
      type="single"
      aria-label={label}
      spacing={0}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next) onValueChange(next);
      }}
      className="grid max-h-72 w-full grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] items-start gap-x-3 gap-y-3 overflow-y-auto rounded-none p-1"
    >
      {sources.map((source) => (
        <ToggleGroupItem
          key={source.id}
          value={source.id}
          title={source.name}
          className="group/picture h-auto touch:h-auto min-w-0 flex-col items-stretch justify-start gap-1.5 rounded-md p-0 text-left font-normal whitespace-normal focus-visible:bg-transparent focus-visible:text-foreground data-[state=on]:bg-transparent"
        >
          <span
            className={cn(
              "relative grid aspect-video place-items-center overflow-hidden rounded-md bg-muted outline-2 outline-offset-2 outline-transparent group-focus-visible/picture:outline-foreground",
              source.id === value && "outline-foreground",
            )}
          >
            {source.thumbnail && (
              <img src={source.thumbnail} alt="" className="size-full object-contain" />
            )}
            {source.id === value && (
              <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background">
                <Check aria-hidden="true" className="size-3.5" />
              </span>
            )}
          </span>
          <span className="line-clamp-2 text-meta">{source.name}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
