// Production route tree with deterministic read responses for the performance harnesses.
// No API writes or playback commands leave this fixture.
import { Profiler, useState, type PropsWithChildren, type ProfilerOnRenderCallback } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { routeTree } from "../src/client/routeTree.gen";
import { SessionGateContext } from "../src/client/session/gate-context";
import type { SessionGateValue } from "../src/client/session/session-context";
import {
  PlaybackClockContext,
  emptyPlaybackClock,
  type PlaybackClock,
} from "../src/client/session/playback-clock";
import { deviceId } from "../src/client/session/device-id";
import { isTvPresentation } from "../src/client/session/presentation";
import { avoidRadioPlaylistId } from "../src/shared/radio";
import type { Action } from "../src/shared/protocol";

const wait = (ms = 160) => new Promise((resolve) => setTimeout(resolve, ms));
const thumbnail = "https://i.ytimg.com/vi/vWLJeqLPfSU/hqdefault.jpg";
const creator = { title: "NPR Music", url: "https://www.youtube.com/@nprmusic" };
const collection = {
  title: "Tiny Desk concerts",
  url: "https://www.youtube.com/playlist?list=PL1B627337ED6F55F0",
  index: 0,
};
const entry = {
  id: "concert",
  title: "Khruangbin: Tiny Desk Concert",
  source: "web:https://www.youtube.com/watch?v=vWLJeqLPfSU",
  thumbnail,
  subtitle: "NPR Music",
  duration: 900,
  creator,
  collection,
};
const station = {
  id: "audit-radio",
  name: "NTS Radio",
  url: "https://stream.example.com/nts",
  homepage: "https://www.nts.live",
  countryCode: "GB",
  codec: "MP3",
  bitrate: 128,
  sourceId: avoidRadioPlaylistId,
  logoUrl: thumbnail,
  tags: ["Community", "Talk"],
  groupTitle: "Community network",
};
const media = {
  id: entry.id,
  provider: "youtube",
  kind: "media",
  url: entry.source.slice(4),
  title: entry.title,
  thumbnail,
  subtitle: entry.subtitle,
  creator,
  collection,
  duration: 900,
  description:
    "Khruangbin perform a live set at NPR Music.\n\nExplore the channel or the full Tiny Desk collection.",
};
const saved = {
  ...media,
  kind: "web",
  source: entry.source,
  sourceLabel: "YouTube",
  savedAt: Date.now(),
};
const history = {
  ...media,
  mediaId: "audit-history",
  sourceLabel: "YouTube",
  position: 120,
  watched: false,
  playable: true,
  queueEntryId: entry.id,
};
export async function mountUiAudit(onRender: ProfilerOnRenderCallback = () => {}) {
  const wasTv = document.body.classList.contains("tv-presentation");
  document.body.classList.toggle("tv-presentation", isTvPresentation());
  const root = createRoot(document.getElementById("fixture")!);
  const originalFetch = window.fetch;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } },
  });
  const id = deviceId();
  const actions: Action[] = [];
  window.fetch = async (input, init) => {
    const url = new URL(String(input), location.href),
      path = url.pathname;
    if (!path.startsWith("/api/")) return originalFetch(input, init);
    if (init?.method && init.method !== "GET") return Response.json({});
    const items = [
      media,
      {
        ...media,
        id: "second",
        title: "Anderson .Paak & The Free Nationals: Tiny Desk Concert",
        url: "https://www.youtube.com/watch?v=ferZnZ0_rSM",
        thumbnail: "https://i.ytimg.com/vi/ferZnZ0_rSM/hqdefault.jpg",
        collection: { ...collection, index: 1 },
      },
    ];
    let body: unknown;
    if (/\/providers\/[^/]+\/items$/.test(path)) {
      const provider = path.split("/")[3]!;
      const target = url.searchParams.get("url") ?? "";
      const single = target.includes("watch") || target.includes("track");
      const title = target.includes("@") ? "NPR Music" : target ? "Tiny Desk concerts" : undefined;
      body = {
        items: items.map((item) => ({
          ...item,
          provider,
          kind: provider === "twitch" ? "media" : item.kind,
          live: provider === "twitch",
          url: provider === "twitch" ? "https://www.twitch.tv/nprmusic" : item.url,
        })),
        ...(target
          ? {
              item: {
                ...media,
                provider,
                url: target,
                kind: single ? "media" : "collection",
                title: single ? media.title : title,
              },
              title: single ? media.title : title,
              thumbnail,
              description: media.description,
            }
          : {}),
      };
    } else if (path === "/api/providers/favorites")
      body = { favorites: [{ ...media, kind: "channel", url: creator.url, title: creator.title }] };
    else if (path === "/api/updates/targets") body = [];
    else if (path === "/api/updates/helpers") body = { status: "idle", checkedAt: null, items: [] };
    else if (path === "/api/devices")
      body = {
        devices: [
          {
            id: deviceId(),
            name: "Studio browser",
            role: "administrator",
            createdAt: Date.now(),
            lastSeenAt: Date.now(),
          },
          {
            id: "audit-tv",
            name: "Living room TV",
            role: "controller",
            createdAt: Date.now(),
            lastSeenAt: Date.now(),
          },
        ],
      };
    else if (path.endsWith("/pairing-code") || path.endsWith("/claim-code"))
      body = { code: "123456" };
    else if (path === "/api/for-later") body = { items: [saved] };
    else if (path === "/api/progress/history") body = { items: [history] };
    else if (path.startsWith("/api/progress/")) body = { item: history };
    else if (path === "/api/playlists")
      body = {
        playlists: [
          {
            id: "audit-list",
            name: "Sunday listening",
            entryCount: 2,
            duration: 1800,
            updatedAt: Date.now(),
          },
        ],
      };
    else if (path.startsWith("/api/playlists/"))
      body = {
        playlist: {
          id: "audit-list",
          name: "Sunday listening",
          entries: [entry, { ...entry, id: "next", title: "The next concert" }],
        },
      };
    else if (path === "/api/radio/avoid")
      body = {
        playlist: { id: avoidRadioPlaylistId, name: "avoid radio", stationCount: 1, error: null },
        stations: [station],
      };
    else if (path === "/api/radio/programmes")
      body = {
        programmes: {
          [station.id]: {
            programmes: [
              {
                id: "morning",
                title: "Early Bird",
                start: Date.now() - 1800000,
                end: Date.now() + 1800000,
                artworkUrl: thumbnail,
                description: "Music for the beginning of the day.",
                categories: ["Jazz", "Experimental"],
              },
              {
                id: "afternoon",
                title: "Afternoon selections",
                start: Date.now() + 1800000,
                end: Date.now() + 5400000,
                categories: ["Ambient"],
                description: "Selections from the community studio.",
              },
            ],
            live: {
              stationId: station.id,
              provider: "radio.avoid.quest",
              title: "Early Bird",
              artist: "Alex",
              genre: "Jazz",
              sampledAt: Date.now() - 1000,
              expiresAt: Date.now() + 60000,
            },
          },
        },
      };
    else if (path === "/api/radio/recognitions") body = { items: [] };
    else if (path === "/api/radio/favorites") body = { favorites: [station] };
    else if (path.startsWith("/api/radio/stations/")) body = { station };
    else if (path === "/api/radio/stations") body = { stations: [station] };
    else if (path === "/api/radio/playlists") body = { playlists: [] };
    else if (path === "/api/radio/sources") body = { sources: [] };
    else if (path === "/api/iptv/sources")
      body = {
        sources: [
          {
            id: "guide",
            name: "Public television",
            channelCount: 1,
            url: "https://example.com/live.m3u",
            updatedAt: Date.now(),
          },
        ],
      };
    else if (path === "/api/iptv/guide")
      body = {
        channels: [
          {
            id: "channel",
            name: "Arts live",
            group: "Culture",
            url: "https://example.com/live.m3u8",
            now: {
              title: "Live performance",
              start: Date.now() - 600000,
              stop: Date.now() + 1800000,
            },
          },
        ],
        total: 1,
        groups: ["Culture"],
      };
    else if (path.endsWith("/logo")) return new Response(null, { status: 404 });
    else return Response.json({ error: "Not available in this fixture." }, { status: 503 });
    return Response.json(body);
  };
  const baseState = {
    installationName: "Living room",
    playback: "p",
    controlling: id,
    currentEntryId: null,
    queue: [entry, { ...entry, id: "next", title: "The next concert" }],
    player: {
      status: "idle",
      playbackId: "p",
      speed: 1,
      volume: 50,
      position: 120,
      duration: 900,
      seekable: true,
      tracks: [],
      error: null,
    },
    devices: [
      {
        id,
        name: "Studio browser",
        role: "administrator",
        online: true,
        volume: 50,
        muted: false,
        sharing: { audio: true, video: true },
      },
      {
        id: "audit-tv",
        name: "Living room TV",
        tv: true,
        online: true,
        volume: 60,
        muted: false,
        sharing: { audio: true, video: true },
      },
    ],
    outputs: [{ deviceId: id, picture: false, sound: true }],
    playbacks: [
      {
        id: "p",
        title: entry.title,
        status: "paused",
        audioOnly: true,
        outputs: [{ deviceId: id, picture: false, sound: true }],
      },
    ],
    liveSources: [],
    preferences: {
      profile: {
        audioLanguage: "",
        subtitleLanguage: "",
        subtitles: "auto",
        speed: 1,
        autoplay: true,
      },
      device: { audioDelay: 0 },
    },
    activeProfile: { id: "default", name: "Everyone" },
    profiles: [{ id: "default", name: "Everyone" }],
    autoplay: { enabled: true, contextTitle: null, upcoming: [] },
    versions: {},
    administratorClaimed: true,
  };
  let gate = {
    credentials: {
      origin: location.origin,
      token: "visual-fixture",
      installationId: "visual-fixture",
    },
    connected: true,
    status: "connected",
    nativeHost: false,
    localHost: false,
    tvPresentation: isTvPresentation(),
    queryClient: client,
    identity: {
      authority: "administrator",
      device: { id, name: "Studio browser", role: "administrator" },
    },
    details: {
      name: "Living room",
      installationId: "visual-fixture",
      urls: [location.origin],
      systemAudio: false,
      tvPresentation: false,
    },
    videoQualityPreference: { quality: "auto", setQuality: () => {} },
    screenWakeLock: { enabled: false, setEnabled: () => {} },
    run: async (action: Action) => {
      actions.push(action);
      return true;
    },
    queue: async (_title: string, work: () => Promise<unknown>) => work(),
    setError: () => {},
    seekBy: async () => true,
    offerUndo: () => {},
    unpair: () => {},
    setCredentials: () => {},
    remoteControlEnabled: true,
    booting: false,
    error: null,
    state: baseState,
  } as unknown as SessionGateValue;
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    context: { queryClient: client, identity: gate.identity, localHost: false, connected: true },
  });
  let setClock!: (clock: PlaybackClock) => void;
  function Clock({ children }: PropsWithChildren) {
    const [clock, update] = useState(emptyPlaybackClock);
    setClock = update;
    return <PlaybackClockContext value={clock}>{children}</PlaybackClockContext>;
  }
  const render = () =>
    root.render(
      <Clock>
        <Profiler id="audit" onRender={onRender}>
          <SessionGateContext value={gate}>
            <QueryClientProvider client={client}>
              <RouterProvider router={router} />
            </QueryClientProvider>
          </SessionGateContext>
        </Profiler>
      </Clock>,
    );
  render();
  await wait(300);
  return {
    async go(href: string, options: { player?: string; video?: boolean; live?: boolean } = {}) {
      const current = options.live
        ? {
            ...entry,
            source: `radio:${station.id}`,
            kind: "radio",
            live: true,
            title: station.name,
            creator: undefined,
            collection: undefined,
            subtitle: undefined,
          }
        : entry;
      gate = {
        ...gate,
        state: {
          ...baseState,
          currentEntryId: options.player ? entry.id : null,
          queue: [current, { ...entry, id: "next", title: "The next concert" }],
          player: { ...baseState.player, status: options.player ?? "idle" },
          outputs: [{ deviceId: id, picture: options.video ?? false, sound: true }],
          playbacks: [{ ...baseState.playbacks[0], audioOnly: !options.video }],
        },
      } as SessionGateValue;
      render();
      await router.navigate({ href });
      await wait(350);
    },
    async updateSession(update: (current: SessionGateValue) => SessionGateValue) {
      gate = update(gate);
      render();
      await wait();
    },
    async updateClock(clock: PlaybackClock) {
      setClock(clock);
      await wait();
    },
    actions,
    close() {
      root.unmount();
      client.clear();
      window.fetch = originalFetch;
      document.body.classList.toggle("tv-presentation", wasTv);
    },
  };
}
