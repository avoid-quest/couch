import { useRef, useState } from "react";
import { Mic, MicOff, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toolPanel } from "@/components/PlaybackTransport";
import type { LiveSharing } from "@/session/live";
import { errorText, useSessionGate } from "@/session/session-context";
import type { LiveVideoFrameRate, LiveVideoQuality } from "../../../shared/live-input";
import { InputLevel, useInputStream } from "./InputLevel";
import { LiveSettings } from "./LiveOperator";
import { frameRateLabels, qualityLabels } from "./share";

// What a share's capture can change while it runs, in its player (SharePlayer.tsx): the gear, Mute and the input's level.

/** The gear: what the capture can change while it runs. Picture and Frame rate; Codec, Capture buffer, Input channels. */
export function ShareGear({
  sharing,
  picture,
  live,
  onChange,
}: {
  sharing: LiveSharing;
  picture: boolean;
  live: boolean;
  onChange: () => void;
}) {
  const { liveSharing, setError } = useSessionGate();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const gear = (
    <Button
      ref={trigger}
      variant="ghost"
      size="icon-lg"
      aria-label={picture ? "Picture" : "Live audio settings"}
      title={picture ? "Picture" : "Live audio settings"}
    >
      <Settings aria-hidden="true" />
    </Button>
  );
  if (picture)
    return (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>{gear}</DropdownMenuTrigger>
        <DropdownMenuContent data-tv-local-only align="end" className="w-64">
          <DropdownMenuLabel>Picture</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sharing.quality}
            onValueChange={(quality) =>
              void liveSharing
                .setQuality(quality as LiveVideoQuality)
                .then(onChange, (reason) => setError(errorText(reason)))
            }
          >
            {Object.entries(qualityLabels).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Frame rate</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={String(sharing.frameRate)}
            onValueChange={(rate) =>
              void liveSharing
                .setFrameRate(Number(rate) as LiveVideoFrameRate)
                .then(onChange, (reason) => setError(errorText(reason)))
            }
          >
            {Object.entries(frameRateLabels).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
            At most; your screen may give fewer.
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  if (!live) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{gear}</PopoverTrigger>
      {open && (
        <PopoverContent
          {...toolPanel(trigger.current)}
          data-tv-local-only
          aria-label="Live audio settings"
          className="w-[min(22rem,calc(100vw-2rem))] p-3"
        >
          <LiveSettings sharing={sharing} onCaptureChange={onChange} />
        </PopoverContent>
      )}
    </Popover>
  );
}

/** Mute audio input, where Play stands: it silences the input for everyone, keeping the share and its listeners. */
export function MuteInput({
  sharing,
  muted,
  onChange,
}: {
  sharing: LiveSharing;
  muted: boolean;
  onChange: () => void;
}) {
  const { liveSharing, connected } = useSessionGate();
  const label = muted ? "Unmute audio input" : "Mute audio input";
  return (
    <Button
      variant={muted ? "secondary" : "default"}
      size="icon-lg"
      className="size-11.5 rounded-full"
      aria-pressed={muted}
      aria-label={label}
      title={label}
      disabled={!connected}
      onClick={() => {
        liveSharing.setMuted(!sharing.muted);
        onChange();
      }}
    >
      {muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
    </Button>
  );
}

/**
 * The input's level: the share's own sound, or for a native input the same device as the browser names it, opened only
 * while this level shows.
 */
export function ShareLevel({ sharing }: { sharing: LiveSharing }) {
  const read = useInputStream(sharing.input ? null : sharing.meterId);
  return <InputLevel stream={sharing.input ?? read} muted={sharing.muted} className="my-1" />;
}
