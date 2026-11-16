import { useRef, useState, type ComponentProps } from "react";
import { MoreHorizontal } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiSend } from "@/api/client";
import { liveAudioSettingsQuery } from "@/api/settings";
import { useNativeInputBufferPreference, useNativeInputChannelPreference } from "@/audio-settings";
import { Button } from "@/components/ui/button";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LiveSharing } from "@/session/live";
import { errorText, useSessionGate } from "@/session/session-context";
import {
  nativeInputBufferFrames,
  nativeInputBufferOptions,
  nativeInputChannelMap,
  nativeInputChannelOptions,
  type LiveAudioSettings,
  type NativeInputBufferPreference,
} from "../../../shared/audio-settings";
import { viewerLine, type Viewer } from "./share";

export function LiveListeners({ viewers }: { viewers: Viewer[] }) {
  const { run, connected } = useSessionGate();
  const list = useRef<HTMLUListElement>(null);
  const removing = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  return (
    <ul ref={list} tabIndex={-1} aria-label="Listeners" className="grid">
      {viewers.map((viewer) => (
        <li key={viewer.device.id} className="flex items-center gap-3 border-t py-2">
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-body [overflow-wrap:anywhere]">{viewer.device.name}</span>
            <span
              role={viewer.error ? "alert" : undefined}
              className={cn(
                "text-meta [overflow-wrap:anywhere]",
                viewer.error ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {viewerLine(viewer, undefined)}
            </span>
          </div>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={!connected || pending === viewer.device.id}
                aria-label={`Options for ${viewer.device.name}`}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              data-tv-local-only
              align="end"
              onCloseAutoFocus={(event) => {
                if (removing.current) {
                  event.preventDefault();
                  list.current?.focus();
                  removing.current = false;
                }
              }}
            >
              <DropdownMenuItem
                onSelect={() => {
                  removing.current = true;
                  setPending(viewer.device.id);
                  void run({
                    type: "removeLiveListener",
                    playbackId: viewer.playbackId,
                    deviceId: viewer.device.id,
                  }).finally(() => setPending(null));
                }}
              >
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      ))}
      {!viewers.length && (
        <li className="border-t py-2.5 text-meta text-muted-foreground">
          <span role="status">No listeners yet.</span>
        </li>
      )}
    </ul>
  );
}

/** The saved Live audio settings: Couch-wide, applied to every Live share and its listeners. */
function useLiveAudioSettings() {
  const { credentials, connected } = useSessionGate();
  const client = useQueryClient();
  const query = useQuery({
    ...liveAudioSettingsQuery(credentials!),
    enabled: !!credentials,
  });
  // Saves carry only the changed field and merge it into the settings current when sent, so Try again can't
  // write back another admin's later change.
  const key = liveAudioSettingsQuery(credentials!).queryKey;
  const save = useMutation({
    mutationFn: (change: Partial<LiveAudioSettings>) =>
      apiSend<LiveAudioSettings>(credentials!, "/api/settings/live-audio", {
        settings: { ...client.getQueryData<LiveAudioSettings>(key)!, ...change },
      }),
    onSuccess: (value) => client.setQueryData(key, value),
  });
  return { settings: query.data, save, query, connected };
}

function LiveSettingsStatus({ live }: { live: ReturnType<typeof useLiveAudioSettings> }) {
  const { query, save, connected } = live;
  if (query.error || save.error)
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {query.error ? "Couldn't load audio settings. " : "Couldn't save audio settings. "}
          {errorText(query.error ?? save.error)}
        </AlertDescription>
        <AlertAction>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!connected || query.isFetching || save.isPending}
            onClick={() => {
              if (query.error) void query.refetch();
              else if (save.variables) save.mutate(save.variables);
            }}
          >
            Try again
          </Button>
        </AlertAction>
      </Alert>
    );
  return (
    <p role="status" className="text-meta text-muted-foreground empty:hidden">
      {!connected
        ? "Reconnect to change audio settings."
        : !query.data
          ? "Loading audio settings…"
          : save.isPending
            ? "Saving audio settings…"
            : ""}
    </p>
  );
}

type CaptureSelectProps = Pick<
  ComponentProps<typeof Select>,
  "value" | "disabled" | "open" | "onOpenChange" | "onValueChange"
> & { id: string; restarting?: boolean };

export function CaptureBufferSelect({ id, restarting, ...props }: CaptureSelectProps) {
  return (
    <Select {...props}>
      <SelectTrigger
        id={id}
        aria-disabled={restarting || undefined}
        className="ml-auto w-44 max-w-full aria-disabled:opacity-50"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent data-tv-local-only>
        {nativeInputBufferOptions.map((value) => (
          <SelectItem key={value} value={value}>
            {value} frames
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function CaptureChannelsSelect({
  id,
  channels,
  restarting,
  ...props
}: CaptureSelectProps & { channels: number }) {
  return (
    <Select {...props}>
      <SelectTrigger
        id={id}
        aria-disabled={restarting || undefined}
        className="ml-auto w-44 max-w-full aria-disabled:opacity-50"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent data-tv-local-only>
        {nativeInputChannelOptions(channels).map((value) => (
          <SelectItem key={value} value={value}>
            {value}, {value.includes("/") ? "Stereo" : "Mono"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Public Sendspin options for the running share; playback timing/recovery stays upstream. */
export function LiveSettings({
  sharing,
  onCaptureChange,
}: {
  sharing: LiveSharing;
  onCaptureChange?: () => void;
}) {
  const { liveSharing, setError } = useSessionGate();
  const live = useLiveAudioSettings();
  const { settings, save } = live;
  const nativeBuffer = useNativeInputBufferPreference();
  const nativeChannels = useNativeInputChannelPreference();
  const [restarting, setRestarting] = useState(false);
  const [opened, setOpened] = useState<"capture" | "channels" | "codec" | null>(null);
  const native = sharing.captureFormat?.native;
  return (
    <div className="grid gap-2 border-t pt-2">
      {native && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <label htmlFor="live-capture-buffer">Capture buffer</label>
          <CaptureBufferSelect
            id="live-capture-buffer"
            open={opened === "capture"}
            onOpenChange={(open) => setOpened(open && !restarting ? "capture" : null)}
            value={String(native.requestedFrames)}
            disabled={!live.connected}
            restarting={restarting}
            onValueChange={(value) => {
              if (restarting) return;
              nativeBuffer.save(value);
              setRestarting(true);
              void liveSharing
                .setCaptureInput({
                  op: "buffer",
                  bufferFrames: nativeInputBufferFrames(value as NativeInputBufferPreference),
                })
                .then(onCaptureChange)
                .catch((reason) => setError(errorText(reason)))
                .finally(() => setRestarting(false));
            }}
          />
        </div>
      )}
      {native && (native.inputChannels ?? 0) > 2 && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <label htmlFor="live-capture-channels">Input channels</label>
          <CaptureChannelsSelect
            id="live-capture-channels"
            open={opened === "channels"}
            onOpenChange={(open) => setOpened(open && !restarting ? "channels" : null)}
            channels={native.inputChannels!}
            value={native.channelMap?.map((channel) => channel + 1).join("/") ?? "1/2"}
            disabled={!live.connected}
            restarting={restarting}
            onValueChange={(value) => {
              if (restarting) return;
              nativeChannels.save(value);
              setRestarting(true);
              void liveSharing
                .setCaptureInput({ op: "channels", channelMap: nativeInputChannelMap(value) })
                .then(onCaptureChange)
                .catch((reason) => setError(errorText(reason)))
                .finally(() => setRestarting(false));
            }}
          />
        </div>
      )}
      <p role="status" className="text-meta text-muted-foreground empty:hidden">
        {restarting ? "Restarting audio input…" : ""}
      </p>
      {(nativeBuffer.error || nativeChannels.error) && (
        <Alert variant="destructive">
          <AlertDescription>{nativeBuffer.error || nativeChannels.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <label htmlFor="live-codec">Codec</label>
        <Select
          open={opened === "codec"}
          onOpenChange={(open) => setOpened(open && !save.isPending ? "codec" : null)}
          value={settings?.codec ?? ""}
          disabled={!live.connected || !settings}
          onValueChange={(codec) => {
            if (settings && !save.isPending)
              save.mutate({ codec: codec as LiveAudioSettings["codec"] });
          }}
        >
          <SelectTrigger
            id="live-codec"
            aria-disabled={save.isPending || undefined}
            className="ml-auto w-44 aria-disabled:opacity-50"
          >
            <SelectValue placeholder="Loading…" />
          </SelectTrigger>
          <SelectContent data-tv-local-only>
            <SelectItem value="auto">Automatic</SelectItem>
            <SelectItem value="pcm">PCM</SelectItem>
            <SelectItem value="opus">Opus</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <LiveSettingsStatus live={live} />
    </div>
  );
}
