import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { PlayOnMenu, usePlayOn } from "@/components/PlayOn";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { collectionLocation, useDetailNavigation } from "@/detail-navigation";
import { linkAction, linkPlays, useLinkStation, type LinkVerb } from "@/pasted-link";
import { createId } from "@/session/session";
import { useShell } from "@/sections/shell/shell-context";
import { supportsWebVideoQuality, videoQualityOptions } from "@/video-quality";
import { linkTarget, type VideoQuality } from "../../../shared/providers";
import { useFirstVerb, type Props } from "./SearchPanel";

/**
 * A pasted link that isn't a list, on the results page: open it as a webpage or as direct media, at a quality, then
 * Play, Queue or Play next; Open page where Couch's provider opens it. A station's page plays its station (focused
 * first on the TV), else opens in the browser.
 */
export function PastedLink({
  url,
  quality,
  onQualityChange,
  onDone,
  ...props
}: Props & {
  url: string;
  quality: VideoQuality;
  onQualityChange: (quality: VideoQuality) => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"Webpage" | "Direct media">("Webpage");
  const [pending, setPending] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setPending(false);
    return () => controller.abort();
  }, [props.origin, props.token, props.connected]);
  const { hostname, pathname } = new URL(url);
  const { on } = usePlayOn();
  const target = linkTarget(url);
  const station = useLinkStation(props, url, target);
  const shell = useShell();
  async function send(verb: LinkVerb, deviceId?: string) {
    if (!props.onCommand || pending || !lifetime.current) return;
    const signal = lifetime.current.signal;
    setPending(true);
    // The command reports its own failure on the page.
    try {
      if (
        (await props.onCommand(
          mode === "Direct media"
            ? {
                type: "enqueue",
                entry: { id: createId(), title: (hostname + pathname).slice(0, 200), source: url },
                ...(verb === "play" ? { playNow: true } : {}),
                ...(verb === "next" ? { placement: "next" as const } : {}),
                deviceId,
              }
            : linkAction(url, target, verb, quality, {}, deviceId),
        )) &&
        !signal.aborted
      )
        onDone();
    } finally {
      if (!signal.aborted) setPending(false);
    }
  }
  // One press plays the station once, as one press sends the link once.
  async function playStation(radio: NonNullable<typeof station>) {
    if (pending || !lifetime.current) return;
    const signal = lifetime.current.signal;
    setPending(true);
    try {
      if ((await shell.enqueueRadio(radio, true)) && !signal.aborted) onDone();
    } finally {
      if (!signal.aborted) setPending(false);
    }
  }
  const navigation = useDetailNavigation();
  const disabled = !props.connected || pending;
  const root = useRef<HTMLElement>(null);
  useFirstVerb(root, !!station && !disabled && props.canPlay, url);
  return (
    <section ref={root} className="max-w-3xl space-y-4">
      <h1 className="sr-only">{hostname + pathname}</h1>
      {target?.shape !== "station" && (
        <SettingsSection>
          <SettingsRow label="Open as">
            <ChoiceGroup
              label="Open link as"
              value={mode}
              onValueChange={setMode}
              disabled={disabled}
              options={[
                { value: "Webpage", label: "Webpage" },
                { value: "Direct media", label: "Direct media" },
              ]}
            />
          </SettingsRow>
          {mode === "Webpage" && supportsWebVideoQuality(url) && (
            <SettingsRow label="Quality">
              <ChoiceGroup
                label="Video quality"
                value={quality}
                onValueChange={onQualityChange}
                disabled={disabled}
                options={videoQualityOptions}
              />
            </SettingsRow>
          )}
        </SettingsSection>
      )}
      <div className="flex flex-wrap gap-2">
        {/* Open shows only where Couch's provider opens the link; a Twitch VOD still plays as a webpage. */}
        {station && (
          <Button
            data-page-first
            disabled={disabled || !props.canPlay}
            onClick={() => void playStation(station)}
          >
            Play {station.name}
          </Button>
        )}
        {station === null && (
          <Button asChild variant="outline">
            <a href={url} target="_blank" rel="noopener noreferrer">
              Open in browser
            </a>
          </Button>
        )}
        {target && target.shape !== "station" && (
          <Button
            variant="outline"
            onClick={() => navigation.open(collectionLocation({ provider: target.provider, url }))}
          >
            Open page
          </Button>
        )}
        {linkPlays(target) && (
          <>
            <Button
              disabled={disabled || !props.canPlay || !props.onCommand}
              onClick={() => void send("play")}
            >
              {on("Play")}
            </Button>
            <PlayOnMenu
              title={hostname + pathname}
              disabled={disabled || !props.canPlay || !props.onCommand}
              onPlay={(deviceId) => void send("play", deviceId)}
            />
            <Button
              variant="ghost"
              disabled={disabled || !props.onCommand}
              onClick={() => void send("queue")}
            >
              Queue
            </Button>
            <Button
              variant="ghost"
              disabled={disabled || !props.onCommand}
              onClick={() => void send("next")}
            >
              Play next
            </Button>
          </>
        )}
        {/^https?:\/\/[^/]*streamingcommunity/i.test(url) && props.onManageSources && (
          <Button variant="ghost" onClick={() => props.onManageSources?.("streaming-community")}>
            StreamingCommunity settings
          </Button>
        )}
      </div>
    </section>
  );
}
