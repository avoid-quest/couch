import { useCallback, useEffect, useRef, useState } from "react";
import { ChoiceGroup } from "@/components/ChoiceGroup";
import { MenuPanel } from "@/components/MenuPanel";
import type { MenuAction } from "@/components/RowMenu";
import { saveLabel } from "@/copy";
import { collectionLocation, useDetailNavigation } from "@/detail-navigation";
import { browserActions } from "@/original-page";
import { linkAction, linkPlays, useLinkStation, type LinkVerb } from "@/pasted-link";
import { createId } from "@/session/session";
import { useShell } from "@/sections/shell/shell-context";
import { supportsWebVideoQuality, videoQualityOptions } from "@/video-quality";
import {
  linkTarget,
  providerNames,
  type ProviderId,
  type VideoQuality,
} from "../../../shared/providers";
import type { PlayOn } from "../../../shared/protocol";
import type { RadioStation } from "../../../shared/radio";
import {
  SearchOnlineResults,
  type SearchHit,
  type SearchResultSummary,
} from "./SearchOnlineResults";
import { SearchRoom, TopResult, useFirstVerb, type Props } from "./SearchPanel";

// Sources whose links hold music or radio; the rest hold video.
const music: ProviderId[] = ["bandcamp", "soundcloud", "mixcloud", "archives", "spotify"];

/**
 * A pasted link that isn't a list, as Search's top result: once Couch has read it (its source's page), its picture,
 * title and source, else the address; then Play with where it plays, Save and its "…" (Play next, Queue, Play on…, its
 * page, Copy link, and quietly Open as direct media and the quality). A station's page plays its station live once Couch
 * finds it; a Play pressed before then waits for it, and nothing here plays a page Couch can't.
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
  const [direct, setDirect] = useState(false);
  const [pending, setPending] = useState(false);
  const [choosingQuality, setChoosingQuality] = useState(false);
  const root = useRef<HTMLElement>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setPending(false);
    return () => controller.abort();
  }, [props.origin, props.token, props.connected]);
  const { hostname, pathname } = new URL(url);
  const address = (hostname + pathname).replace(/\/$/, "");
  const target = linkTarget(url);
  const station = useLinkStation(props, url, target);
  const shell = useShell();
  const navigation = useDetailNavigation();
  // What the link's source says it is, read as a search result is.
  const [summary, setSummary] = useState<SearchResultSummary>();
  const onResults = useCallback((_: string, next: SearchResultSummary) => setSummary(next), []);
  const read = target && target.shape !== "station" && !direct ? summary?.collection : undefined;
  // A command that runs once per press; its own failure shows on the page.
  async function once(work: () => Promise<boolean>) {
    if (pending || !lifetime.current) return;
    const signal = lifetime.current.signal;
    setPending(true);
    try {
      if ((await work()) && !signal.aborted) onDone();
    } finally {
      if (!signal.aborted) setPending(false);
    }
  }
  const send = (verb: LinkVerb, on?: PlayOn) =>
    props.onCommand &&
    void once(() =>
      props.onCommand!(
        direct
          ? {
              type: "enqueue",
              entry: { id: createId(), title: address.slice(0, 200), source: url },
              ...(verb === "play" ? { playNow: true } : {}),
              ...(verb === "next" ? { placement: "next" as const } : {}),
              ...on,
            }
          : linkAction(url, target, verb, quality, {}, on),
      ),
    );
  const playStation = (radio: RadioStation, on?: PlayOn) =>
    void once(() => shell.enqueueRadio(radio, true, on));
  // Play pressed while Couch still looks for the station plays it once found; this page is the link's, so a new link
  // starts without it.
  const [waiting, setWaiting] = useState<PlayOn | true | null>(null);
  useEffect(() => {
    if (!waiting || station === undefined) return;
    setWaiting(null);
    if (station) playStation(station, waiting === true ? undefined : waiting);
  }, [waiting, station]);
  const disabled = !props.connected || pending;
  const isStation = target?.shape === "station";
  const plays = direct || (linkPlays(target) && !isStation);
  const opens = !direct && target && !isStation;
  const page = opens && {
    label: target.shape === "page" ? "Open" : "Details",
    run: () => navigation.open(collectionLocation({ provider: target.provider, url })),
  };
  const title = direct ? address : (station?.name ?? read?.title ?? address);
  const verbs: MenuAction[] = isStation
    ? station !== null
      ? [
          {
            label: "Play",
            group: "play",
            disabled: disabled || !props.canPlay || !!waiting,
            run: () => (station ? playStation(station) : setWaiting(true)),
          },
          {
            label: "Play on",
            group: "play",
            disabled: disabled || !props.canPlay || !!waiting,
            audioOnly: true,
            thumbnail: station?.logoUrl,
            playOn: (on) => (station ? playStation(station, on) : setWaiting(on)),
          },
        ]
      : []
    : plays
      ? [
          {
            label: "Play",
            group: "play",
            disabled: disabled || !props.canPlay || !props.onCommand,
            run: () => send("play"),
          },
          {
            label: "Play next",
            group: "play",
            disabled: disabled || !props.onCommand,
            run: () => send("next"),
          },
          {
            label: "Queue",
            group: "play",
            disabled: disabled || !props.onCommand,
            run: () => send("queue"),
          },
          {
            label: "Play on",
            group: "play",
            disabled: disabled || !props.canPlay || !props.onCommand,
            thumbnail: read?.thumbnail,
            audioOnly: !!target && music.includes(target.provider),
            playOn: (on) => send("play", on),
          },
        ]
      : [];
  // A page Couch only opens (Mixcloud's playlists) never plays, as direct media either.
  const options: MenuAction[] = [
    ...(linkPlays(target)
      ? [
          {
            label: direct ? "Open as webpage" : "Open as direct media",
            group: "link",
            disabled: pending,
            run: () => setDirect(!direct),
          },
        ]
      : []),
    ...(!direct && plays && supportsWebVideoQuality(url)
      ? [
          {
            label: `Quality: ${videoQualityOptions.find((option) => option.value === quality)?.label ?? "1080p"}…`,
            group: "link",
            disabled: pending,
            // Its choices open from the stage's "…", which opened them.
            run: () => {
              anchor.current =
                root.current?.querySelector<HTMLElement>("[data-row-options]") ?? null;
              setChoosingQuality(true);
            },
          },
        ]
      : []),
    ...(target?.provider === "streamingcommunity" && props.onManageSources
      ? [
          {
            label: "StreamingCommunity settings",
            group: "link",
            run: () => props.onManageSources?.("streaming-community"),
          },
        ]
      : []),
  ];
  const hit: SearchHit = {
    id: `link:${url}`,
    kind: isStation ? "Radio" : target && music.includes(target.provider) ? "Music" : "Video",
    source: direct
      ? "Direct media"
      : isStation
        ? "Radio"
        : (read?.source ?? (target ? providerNames[target.provider] : hostname)),
    title,
    meta: (!direct && read?.subtitle) || "",
    url,
    thumbnail: direct ? undefined : (station?.logoUrl ?? read?.thumbnail),
    duration: read?.single ? read.duration : undefined,
    primary: plays
      ? { label: "Play", run: () => send("play") }
      : page
        ? {
            label: page.label,
            href: collectionLocation({ provider: target!.provider, url }),
            run: page.run,
          }
        : {
            label: "Open in browser",
            run: () => void window.open(url, "_blank", "noopener,noreferrer"),
          },
    actions: [
      ...verbs,
      ...(read?.save && !(target?.shape === "page" && !plays)
        ? [
            {
              label: saveLabel(!!read.saved, read.single ? "For later" : "Saved"),
              group: "keep",
              pressed: !!read.saved,
              disabled: !props.connected || !!read.saveDisabled,
              run: read.save,
            },
          ]
        : []),
      ...(page && plays ? [{ ...page, group: "go" }] : []),
      ...(station === null ? [] : browserActions(url, title)),
      ...options,
    ],
  };
  useFirstVerb(root, !disabled && props.canPlay && (!isStation || !!station), url);
  return (
    <section ref={root} aria-label={title} className="space-y-8">
      <SearchRoom thumbnail={hit.thumbnail} />
      <TopResult hit={hit} />
      {target && !isStation && !direct && (
        <SearchOnlineResults
          {...props}
          onResults={onResults}
          provider={target.provider}
          query=""
          url={url}
          paged
          quality={quality}
          onEnqueued={onDone}
        />
      )}
      {choosingQuality && (
        <MenuPanel title="Quality" anchor={anchor} onClose={() => setChoosingQuality(false)}>
          <ChoiceGroup
            label="Video quality"
            value={quality}
            onValueChange={(value) => {
              onQualityChange(value);
              setChoosingQuality(false);
            }}
            options={videoQualityOptions}
          />
        </MenuPanel>
      )}
    </section>
  );
}
