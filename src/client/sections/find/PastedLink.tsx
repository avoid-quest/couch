import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { PlayPill, usePlayOn } from "@/components/PlayOn";
import { ItemMenu, useItemMenu } from "@/components/RowMenu";
import { verbRow } from "@/components/DetailHeader";
import { browserActions } from "@/original-page";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { collectionLocation, useDetailNavigation } from "@/detail-navigation";
import { linkAction, linkPlays, useLinkStation, type LinkVerb } from "@/pasted-link";
import { createId } from "@/session/session";
import { useShell } from "@/sections/shell/shell-context";
import { supportsWebVideoQuality, videoQualityOptions } from "@/video-quality";
import { linkTarget, type VideoQuality } from "../../../shared/providers";
import type { PlayOn } from "../../../shared/protocol";
import { useFirstVerb, type Props } from "./SearchPanel";

/**
 * A pasted link that isn't a list, on the results page: open it as a webpage or as direct media, at a quality, then
 * Play with where it plays, and the rest (Play next, Queue, Open page where Couch's provider opens it) in its "…". A
 * station's page plays its station (focused first on the TV), else opens in the browser.
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
  async function send(verb: LinkVerb, playOn?: PlayOn) {
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
                ...playOn,
              }
            : linkAction(url, target, verb, quality, {}, playOn),
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
  // Open page shows only where Couch's provider opens the link; a Twitch VOD still plays as a webpage.
  const page =
    target && target.shape !== "station"
      ? {
          label: "Open page",
          group: "go",
          run: () => navigation.open(collectionLocation({ provider: target.provider, url })),
        }
      : undefined;
  const plays = linkPlays(target) && !station;
  const menu = useItemMenu([
    ...(plays
      ? [
          {
            label: "Play next",
            group: "play",
            disabled: disabled || !props.onCommand,
            run: () => void send("next"),
          },
          {
            label: "Queue",
            group: "play",
            disabled: disabled || !props.onCommand,
            run: () => void send("queue"),
          },
        ]
      : []),
    ...(page && (plays || station) ? [page] : []),
    ...(station === null ? [] : browserActions(url)),
    ...(/^https?:\/\/[^/]*streamingcommunity/i.test(url) && props.onManageSources
      ? [
          {
            label: "StreamingCommunity settings",
            group: "settings",
            run: () => props.onManageSources?.("streaming-community"),
          },
        ]
      : []),
  ]);
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
      <div data-nav-row className={verbRow}>
        {station ? (
          <Button
            data-page-first
            size="lg"
            disabled={disabled || !props.canPlay}
            onClick={() => void playStation(station)}
          >
            Play {station.name}
          </Button>
        ) : linkPlays(target) ? (
          <PlayPill
            size="lg"
            label="Play"
            aria-label={on(`Play ${hostname + pathname}`)}
            title={hostname + pathname}
            disabled={disabled || !props.canPlay || !props.onCommand}
            onClick={() => void send("play")}
            playOn={(playOn) => void send("play", playOn)}
          />
        ) : page ? (
          <Button size="lg" onClick={page.run}>
            Open page
          </Button>
        ) : (
          station === null && (
            <Button asChild size="lg" variant="secondary">
              <a href={url} target="_blank" rel="noopener noreferrer">
                Open in browser
              </a>
            </Button>
          )
        )}
        <ItemMenu menu={menu} size="icon-lg" title={hostname + pathname} className="opacity-100" />
      </div>
    </section>
  );
}
