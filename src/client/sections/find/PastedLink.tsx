import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { PlayOnMenu, usePlayOn } from "@/components/PlayOn";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { collectionLocation, useDetailNavigation } from "@/detail-navigation";
import { linkAction, linkPlays, type LinkVerb } from "@/pasted-link";
import { createId } from "@/session/session";
import { supportsWebVideoQuality, videoQualityOptions } from "@/video-quality";
import { linkTarget, type VideoQuality } from "../../../shared/providers";
import type { Props } from "./SearchPanel";

/**
 * A pasted link that isn't a list, on the results page: open it as a webpage or as direct media, at a quality, then
 * Play, Queue or Play next; Open page where Couch's provider opens it.
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
  const navigation = useDetailNavigation();
  const disabled = !props.connected || pending;
  return (
    <section className="max-w-3xl space-y-4">
      <h1 className="sr-only">{hostname + pathname}</h1>
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
      <div className="flex flex-wrap gap-2">
        {/* Open shows only where Couch's provider opens the link; a Twitch VOD still plays as a webpage. */}
        {target && (
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
