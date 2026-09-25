// PROTOTYPE — throwaway. Shared data for the UI-direction variants on /prototype.
// Search is real (provider, radio and library APIs). The player is SIMULATED:
// the dev server has no desktop player, so playback is an in-memory stub.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type ApiCredentials } from "@/api/client";
import type { ProviderItem, ProviderPage } from "../../../shared/providers";
import type { RadioProgrammeDetails, RadioStation } from "../../../shared/radio";
import type { LibrarySearch } from "../../../shared/library";

export type Source = "YouTube" | "Twitch" | "RaiPlay" | "Radio" | "Folders";
export type Kind = "video" | "music" | "live" | "radio" | "list";
export type Length = "short" | "episode" | "long";
export type Hit = { id: string; source: Source; kind: Kind; title: string; by?: string; art?: string; duration?: number; description?: string; url?: string; /** Resume point, for Continue. */ position?: number };
export type Filters = { sources: Source[]; kinds: Kind[]; lengths: Length[] };

export const allSources: Source[] = ["YouTube", "Twitch", "RaiPlay", "Radio", "Folders"];
export const allKinds: Kind[] = ["video", "music", "live", "radio", "list"];
export const allLengths: Length[] = ["short", "episode", "long"];
export const noFilters: Filters = { sources: [], kinds: [], lengths: [] };

export const lengthOf = (hit: Hit): Length | null => hit.duration == null ? null : hit.duration < 600 ? "short" : hit.duration <= 3600 ? "episode" : "long";

export const provider = (source: Source) => (item: ProviderItem): Hit => ({
  id: item.id, source, title: item.title, by: item.subtitle, duration: item.duration, description: item.description, url: item.url,
  kind: item.live ? "live" : item.kind === "media" ? "video" : "list",
  art: bigArt(item.thumbnail, item.url),
});

// YouTube serves a 1280px frame for every video id; other hosts keep theirs.
function bigArt(thumbnail?: string, url?: string) {
  const id = url?.match(/[?&]v=([\w-]{11})/)?.[1];
  return id ? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` : thumbnail;
}
export const smallArt = (hit: Hit) => hit.art?.replace("/maxresdefault.jpg", "/mqdefault.jpg");

const station = (programmes: Record<string, RadioProgrammeDetails>) => (item: RadioStation): Hit => ({
  id: `radio-${item.id}`, source: "Radio", kind: "radio", title: item.name, art: programmes[item.id]?.artworkUrl ?? item.logoUrl ?? undefined,
  by: programmes[item.id]?.title ?? ([item.countryCode, item.codec && `${item.codec} ${item.bitrate || ""}`.trim()].filter(Boolean).join(" ") || undefined),
});

function matches(hit: Hit, filters: Filters, skip?: keyof Filters) {
  const length = lengthOf(hit);
  return (skip === "sources" || !filters.sources.length || filters.sources.includes(hit.source))
    && (skip === "kinds" || !filters.kinds.length || filters.kinds.includes(hit.kind))
    && (skip === "lengths" || !filters.lengths.length || (length !== null && filters.lengths.includes(length)));
}

// Include-set toggling (empty = everything) and exclude-style toggling for strike-through UIs.
export function toggle<T>(values: T[], value: T) { return values.includes(value) ? values.filter(v => v !== value) : [...values, value]; }
export function toggleExcluded<T>(values: T[], all: T[], value: T) {
  const included = values.length ? values : all;
  const next = toggle(included, value);
  return next.length === all.length || !next.length ? [] : next;
}
export const isIncluded = <T,>(values: T[], value: T) => !values.length || values.includes(value);

function useSearch(credentials: ApiCredentials, query: string, programmes: Record<string, RadioProgrammeDetails>) {
  const q = query.trim();
  const enabled = q.length > 1 && !/^https?:\/\//i.test(q);
  const read = <T,>(path: string, signal: AbortSignal) => apiFetch(credentials, path, { signal }, 30_000).then(r => r.json() as Promise<T>);
  const providers = [["YouTube", "youtube"], ["Twitch", "twitch"], ["RaiPlay", "raiplay"]] as const;
  const results = useQueries({ queries: [
    ...providers.map(([source, id]) => ({ queryKey: ["proto", id, q], enabled, retry: false, staleTime: 600_000,
      queryFn: ({ signal }: { signal: AbortSignal }) => read<ProviderPage>(`/api/providers/${id}/items?${new URLSearchParams({ q })}`, signal).then(page => page.items.map(provider(source))) })),
    { queryKey: ["proto", "radio", q], enabled, retry: false, staleTime: 600_000,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const [avoid, directory] = await Promise.allSettled([read<{ stations: RadioStation[] }>("/api/radio/avoid", signal), read<{ stations: RadioStation[] }>(`/api/radio/stations?${new URLSearchParams({ q })}`, signal)]);
        const own = avoid.status === "fulfilled" ? avoid.value.stations.filter(s => `${s.name} ${programmes[s.id]?.title ?? ""}`.toLowerCase().includes(q.toLowerCase())) : [];
        return [...own, ...(directory.status === "fulfilled" ? directory.value.stations.slice(0, 12) : [])].map(station(programmes));
      } },
    { queryKey: ["proto", "folders", q], enabled, retry: false, staleTime: 600_000,
      queryFn: ({ signal }: { signal: AbortSignal }) => read<LibrarySearch>(`/api/library/items?${new URLSearchParams({ q, limit: "30" })}`, signal)
        .then(page => page.items.map((item): Hit => ({ id: item.id, source: "Folders", kind: item.kind === "audio" ? "music" : "video", title: item.title, by: item.artist ?? item.video?.show?.title ?? undefined, duration: item.duration ?? undefined }))) },
  ] });
  const sourceOrder: Source[] = ["YouTube", "Twitch", "RaiPlay", "Radio", "Folders"];
  const hits = enabled ? results.flatMap(r => r.data ?? []) : [];
  const loading = Object.fromEntries(sourceOrder.map((source, index) => [source, enabled && results[index]!.isFetching])) as Record<Source, boolean>;
  return { hits, loading, pending: Object.values(loading).some(Boolean), active: enabled };
}

// ---- simulated player -------------------------------------------------------
export type Entry = Hit & { entryId: string; /** The device that queued it. */ addedBy: string };
export type Notice = { id: number; text: string; undo?: () => void };
export type Chapter = { title: string; position: number };

export function chaptersOf(hit?: Hit): Chapter[] {
  if (!hit?.description || !hit.duration) return [];
  const found = [...hit.description.matchAll(/(?:^|\s)(\d{1,2}:\d{2}(?::\d{2})?)\s+([^\d\n][^\n]*?)(?=\s+\d+\.\s|\s+\d{1,2}:\d{2}|$)/g)]
    .map(([, time, title]) => ({ position: time!.split(":").reduce((sum, part) => sum * 60 + Number(part), 0), title: title!.replace(/^\d+\.\s*/, "").replace(/\s*\d+\.?$/, "").trim() }))
    .filter(chapter => chapter.position < hit.duration!);
  return found.length > 1 ? found : [];
}

// Actions taken on this screen are "you"; other names are paired remotes.
export const HERE = "you";
function usePlayer(seed: Hit[], notify: (text: string, undo?: () => void) => void) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(62);
  const [speed, setSpeed] = useState(1);
  const [subtitles, setSubtitles] = useState("Off");
  const [audio, setAudio] = useState("Original");
  const [quality, setQuality] = useState("Auto");
  const [audioDelay, setAudioDelay] = useState(0);
  const [subtitleDelay, setSubtitleDelay] = useState(0);
  const [normalisation, setNormalisation] = useState<"Off" | "Track" | "Album">("Off");
  // Scenario override for states the stub can't reach by itself.
  const [override, setOverride] = useState<null | "loading" | "buffering" | "retrying" | "error">(null);
  const [atLiveEdge, setAtLiveEdge] = useState(true);
  const [icy, setIcy] = useState(0);
  const seeded = useRef(false);
  const index = entries.findIndex(e => e.entryId === currentId);
  const current = index >= 0 ? entries[index] : undefined;
  const make = (hit: Hit, addedBy = HERE): Entry => ({ ...hit, addedBy, entryId: `${hit.id}-${Math.random().toString(36).slice(2, 7)}` });

  useEffect(() => {
    if (seeded.current || seed.length < 4) return;
    seeded.current = true;
    const queued = seed.map((hit, i) => make(hit, ["Pixel 8", "Pixel 8", HERE, "iPad", "iPad"][i % 5]));
    setEntries(queued); setCurrentId(queued[1]!.entryId); setPosition(Math.round((queued[1]!.duration ?? 600) * .37));
  }, [seed]);
  useEffect(() => { setOverride(null); setAtLiveEdge(true); }, [currentId]);
  // Radio streams announce their current track (ICY metadata) every so often.
  useEffect(() => { if (current?.kind !== "radio") return; const timer = setInterval(() => setIcy(n => n + 1), 20_000); return () => clearInterval(timer); }, [current?.entryId]);

  const next = () => {
    const following = entries[index + 1];
    setPosition(0);
    setCurrentId(following?.entryId ?? null);
  };
  const nextRef = useRef(next); nextRef.current = next;
  useEffect(() => {
    if (!current || paused) return;
    const timer = setInterval(() => setPosition(value => {
      if (current.duration != null && value + speed >= current.duration) { queueMicrotask(() => nextRef.current()); return current.duration; }
      return value + speed;
    }), 1000);
    return () => clearInterval(timer);
  }, [current?.entryId, paused, speed]);

  const mode: "video" | "audio" | "live" = !current ? "video" : current.kind === "radio" || current.kind === "music" ? "audio" : current.kind === "live" ? "live" : "video";
  const status = !current ? "idle" : override ?? (paused ? "paused" : "playing");
  return {
    entries, current, position, paused, volume, speed, subtitles, audio,
    /** video: picture with a duration. audio: no picture (music, radio). live: picture without an end. */
    mode,
    /** idle | playing | paused | loading | buffering | retrying | error */
    status,
    error: override !== "error" ? null : current?.kind === "radio" ? "The station stopped sending audio." : current?.kind === "music" ? "The file is missing from its folder." : current?.kind === "live" ? "This stream has ended." : "This video is unavailable in your country.",
    retry: override === "retrying" ? { attempt: 2, maximum: 5, inSeconds: 8 } : null,
    /** Radio: the track the stream says is playing right now (ICY metadata). */
    nowPlaying: current?.kind === "radio" ? icyTracks[icy % icyTracks.length] : null,
    /** Live: whether we're watching the live edge (goLive jumps back to it). */
    atLiveEdge, goLive() { setAtLiveEdge(true); },
    seekable: !!current && current.duration != null,
    quality, qualities: ["Auto", "Best", "1080p", "720p", "480p"], setQuality,
    audioDelay, setAudioDelay, subtitleDelay, setSubtitleDelay, normalisation, setNormalisation,
    setOverride,
    history: index > 0 ? entries.slice(0, index) : [],
    upNext: index >= 0 ? entries.slice(index + 1) : entries,
    chapters: chaptersOf(current),
    live: !!current && current.duration == null,
    subtitleTracks: ["Off", "English", "Italiano"], audioTracks: ["Original", "Italiano"], speeds: [0.5, 0.75, 1, 1.25, 1.5, 2],
    // Shared actions happen at once and offer Undo instead of asking first.
    playNow(hit: Hit, by = HERE) {
      const entry = make(hit, by), was = current && { id: current.entryId, position };
      setEntries(list => [...list.slice(0, index + 1), entry, ...list.slice(index + 1)]); setCurrentId(entry.entryId); setPosition(hit.position ?? 0); setPaused(false);
      if (was) notify(`${by === HERE ? "Playing" : `${by} started`} ${hit.title.slice(0, 48)}`, () => { setEntries(list => list.filter(e => e.entryId !== entry.entryId)); setCurrentId(was.id); setPosition(was.position); });
    },
    // Couch's "Up next" appends to the end of the shared queue.
    addNext(hit: Hit, by = HERE) { setEntries(list => [...list, make(hit, by)]); },
    // Not in Couch yet: insert right after what's playing.
    playNext(hit: Hit) { setEntries(list => [...list.slice(0, index + 1), make(hit), ...list.slice(index + 1)]); },
    play(entryId: string) { setCurrentId(entryId); setPosition(0); setPaused(false); setOverride(null); },
    remove(entryId: string) {
      const at = entries.findIndex(e => e.entryId === entryId), removed = entries[at];
      if (entryId === currentId) next(); setEntries(list => list.filter(e => e.entryId !== entryId));
      if (removed) notify(`Removed ${removed.title.slice(0, 48)} from Up next`, () => setEntries(list => [...list.slice(0, at), removed, ...list.slice(at)]));
    },
    move(entryId: string, beforeId: string | null) {
      setEntries(list => { const moving = list.find(e => e.entryId === entryId)!; const rest = list.filter(e => e.entryId !== entryId); const at = beforeId ? rest.findIndex(e => e.entryId === beforeId) : rest.length; return [...rest.slice(0, at), moving, ...rest.slice(at)]; });
    },
    toggle() { setPaused(value => !value); },
    seek(seconds: number) { if (current?.duration != null) setPosition(Math.max(0, Math.min(current.duration - 1, seconds))); },
    skip(delta: number) {
      if (current?.duration != null) setPosition(value => Math.max(0, Math.min(current.duration! - 1, value + delta)));
      else if (current?.kind === "live" && delta < 0) setAtLiveEdge(false);
    },
    next,
    stop(quiet = false) { const was = current && { id: current.entryId, position }; setCurrentId(null); setPosition(0); if (was && !quiet) notify("Stopped", () => { setCurrentId(was.id); setPosition(was.position); }); },
    setVolume, setSpeed, setSubtitles, setAudio,
  };
}
export type Player = ReturnType<typeof usePlayer>;

const icyTracks = ["Ghislaine Mirat — Tantrique Doner", "Laurel Halo — Sick Mind", "Beatrice Dillon — Clouds Strata", "Jon Hassell — Pastoral Tribe", "Kali Malone — Spectacle of Ritual"];

// ---- context ------------------------------------------------------------------
function useProtoValue(credentials: ApiCredentials) {
  const programmesQuery = useQuery({ queryKey: ["proto", "programmes"], staleTime: 60_000, retry: false,
    queryFn: ({ signal }) => apiFetch(credentials, "/api/radio/avoid/programmes", { signal }, 45_000).then(r => r.json() as Promise<{ programmes: Record<string, RadioProgrammeDetails> }>).then(r => r.programmes) });
  const programmes = programmesQuery.data ?? {};
  const stations = useQuery({ queryKey: ["proto", "avoid"], staleTime: 600_000, retry: false,
    queryFn: ({ signal }) => apiFetch(credentials, "/api/radio/avoid", { signal }).then(r => r.json() as Promise<{ stations: RadioStation[] }>).then(r => r.stations) }).data ?? [];
  // Stations with a known programme first: that is what's "on air now".
  const onAir = [...stations].sort((a, b) => Number(!!programmes[b.id]) - Number(!!programmes[a.id])).map(station(programmes));

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(noFilters);
  const search = useSearch(credentials, query, programmes);
  const visible = useMemo(() => search.hits.filter(hit => matches(hit, filters)), [search.hits, filters]);
  const count = (facet: keyof Filters, value: string) => search.hits.filter(hit => matches(hit, filters, facet) && (facet === "sources" ? hit.source === value : facet === "kinds" ? hit.kind === value : lengthOf(hit) === value)).length;

  const client = useQueryClient();
  const [seed, setSeed] = useState<Hit[]>([]);
  const [catalog, setCatalog] = useState<Hit[]>([]);
  useEffect(() => {
    void client.fetchQuery({ queryKey: ["proto", "youtube", "aphex twin"], staleTime: 600_000,
      queryFn: ({ signal }) => apiFetch(credentials, `/api/providers/youtube/items?q=aphex+twin`, { signal }, 30_000).then(r => r.json() as Promise<ProviderPage>).then(page => page.items.map(provider("YouTube"))) })
      // A real music video leads, so the controls are judged over moving footage.
      .then(hits => { setCatalog(hits); const videos = hits.filter(hit => hit.kind === "video"); const motion = videos.filter(hit => /daddy|vordhosbn|windowlicker|rubber/i.test(hit.title)); setSeed([...new Set([videos[0]!, ...motion, ...videos])].slice(0, 6)); }).catch(() => undefined);
  }, []);
  const [live, setLive] = useState<Hit | null>(null);
  useEffect(() => {
    void apiFetch(credentials, `/api/providers/twitch/items?q=music`, {}, 30_000).then(r => r.json() as Promise<ProviderPage>)
      .then(page => setLive(page.items.map(provider("Twitch")).find(hit => hit.kind === "live") ?? null)).catch(() => undefined);
  }, []);
  const withEverything = useMemo(() => {
    // Wait for programmes so the seeded station carries what's on air.
    if (!seed.length || !onAir[0] || !live || programmesQuery.isPending) return [];
    // Stand-in for a track from your folders: audio only, album artwork, no picture.
    const track: Hit = { id: "folders-avril-14th", source: "Folders", kind: "music", title: "Avril 14th", by: "Aphex Twin, Drukqs", duration: 125, art: seed[3]?.art };
    return [seed[0]!, seed[1]!, track, onAir[0], live, ...seed.slice(2)];
  }, [seed, onAir[0]?.id, live, programmesQuery.isPending]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const noticeId = useRef(0);
  const notify = (text: string, undo?: () => void) => {
    const id = ++noticeId.current;
    setNotices(list => [...list.slice(-2), { id, text, undo }]);
    setTimeout(() => setNotices(list => list.filter(n => n.id !== id)), undo ? 6000 : 4000);
  };
  const dismiss = (id: number) => setNotices(list => list.filter(n => n.id !== id));
  const player = usePlayer(withEverything, notify);
  // Prototype-only: someone else in the room uses their phone.
  const remoteActs = () => {
    const pick = catalog[Math.floor(Math.random() * catalog.length)];
    const acts = [
      () => { player.toggle(); notify(`iPad ${player.paused ? "resumed" : "paused"}`); },
      () => { if (pick) { player.addNext(pick, "Pixel 8"); notify(`Pixel 8 added ${pick.title.slice(0, 48)}`); } },
      () => { player.setVolume(v => Math.max(0, v - 10)); notify("iPad turned the volume down"); },
    ];
    acts[Math.floor(Math.random() * acts.length)]!();
  };
  // Stand-ins for /api/progress/history (unfinished only), /api/for-later, saved lists and kept items.
  const [continuing, setContinuing] = useState<Hit[]>([]);
  const [later, setLater] = useState<Hit[]>([]);
  useEffect(() => {
    if (!catalog.length) return;
    setContinuing(catalog.filter(hit => (hit.duration ?? 0) > 1800).slice(0, 2).map((hit, i) => ({ ...hit, position: Math.round(hit.duration! * [.34, .71][i]!) })));
    // One "Save" for everything; Saved sorts it into media vs channels and stations.
    setLater([...catalog.filter(hit => hit.kind === "video" && (hit.duration ?? 0) < 1800).slice(-3), ...catalog.filter(h => h.kind === "list").slice(0, 2), ...onAir.slice(0, 2)]);
  }, [catalog]);
  const forgetProgress = (hit: Hit) => { const before = continuing; setContinuing(list => list.filter(h => h.id !== hit.id)); notify(`Removed ${hit.title.slice(0, 48)} from Continue`, () => setContinuing(before)); };
  const saveForLater = (hit: Hit) => setLater(list => list.some(h => h.id === hit.id) ? list.filter(h => h.id !== hit.id) : [...list, hit]);
  const [lists, setLists] = useState<{ id: string; name: string; items: Hit[] }[]>([]);
  useEffect(() => { if (catalog.length) setLists([{ id: "l1", name: "Sunday morning", items: catalog.filter(h => h.kind === "video").slice(0, 5) }, { id: "l2", name: "Long ones", items: catalog.filter(h => (h.duration ?? 0) > 3600).slice(0, 3) }]); }, [catalog]);
  // App-level state the prototype bar can flip: who you are, the connection, first run.
  const [app, setApp] = useState({ role: "admin" as "admin" | "controller", connection: "online" as "online" | "reconnecting", welcome: false, host: "Living room", self: "Living room", fresh: false });
  // A fresh install has nothing to continue and nothing saved.
  const home = app.fresh ? { continuing: [] as Hit[], later: [] as Hit[] } : { continuing, later };
  return { notices, notify, dismiss, remoteActs, credentials, ...home, forgetProgress, saveForLater, lists, setLists, app, setApp, query, setQuery, filters, setFilters, ...search, visible, count, onAir, player };
}
export type Proto = ReturnType<typeof useProtoValue>;
const ProtoContext = createContext<Proto | null>(null);
export function ProtoProvider({ credentials, children }: { credentials: ApiCredentials; children: React.ReactNode }) {
  return <ProtoContext.Provider value={useProtoValue(credentials)}>{children}</ProtoContext.Provider>;
}
export const useProto = () => useContext(ProtoContext)!;

// ---- small helpers ----------------------------------------------------------------
export function clock(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const s = Math.floor(seconds), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}
export function spoken(seconds?: number | null) {
  if (seconds == null) return "";
  const m = Math.round(seconds / 60);
  return m < 1 ? "under a minute" : m < 60 ? `${m} minute${m === 1 ? "" : "s"}` : `${Math.floor(m / 60)} hour${m >= 120 ? "s" : ""}${m % 60 ? ` ${m % 60} min` : ""}`;
}
// "Aphex Twin - Come To Daddy (Director's Cut)" → { artist: "Aphex Twin", title: "Come To Daddy" }
export function splitTitle(hit?: Pick<Hit, "title" | "by">) {
  if (!hit) return { title: "", artist: undefined as string | undefined };
  const [head, ...rest] = hit.title.split(/\s[-–—]\s/);
  const clean = (value: string) => value.replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/["“”]/g, "").trim();
  return rest.length ? { artist: clean(head!), title: clean(rest.join(" - ")) || hit.title } : { artist: hit.by, title: clean(hit.title) || hit.title };
}
// ---- the picture -------------------------------------------------------------------
// Real moving video for the simulated player: YouTube and Twitch embeds, muted,
// following the stub's clock. Renders nothing for audio-only media, so each
// variant designs its own audio stage. Fills its (positioned) parent like object-fit: cover.
export function ProtoVideo({ className = "" }: { className?: string }) {
  const { player } = useProto();
  const frame = useRef<HTMLIFrameElement>(null);
  const current = player.current;
  const youtube = current?.url?.match(/[?&]v=([\w-]{11})/)?.[1];
  const twitch = current?.source === "Twitch" ? current.url?.match(/twitch\.tv\/([\w]+)/)?.[1] : undefined;
  // Cover-fit measured in JS: container units misbehave under the TV canvas zoom.
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = box.current; if (!element) return;
    const observer = new ResizeObserver(() => { const { clientWidth: w, clientHeight: h } = element; const width = Math.max(w, h * 16 / 9) * 1.12; setSize({ width, height: width * 9 / 16 }); });
    observer.observe(element); return () => observer.disconnect();
  });
  const start = useRef(0);
  const [startedAt, setStartedAt] = useState(current?.entryId);
  if (startedAt !== current?.entryId) { setStartedAt(current?.entryId); start.current = Math.floor(player.position); }
  const send = (func: string, args: unknown[] = []) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
  useEffect(() => { if (youtube) send(player.paused || player.status !== "playing" ? "pauseVideo" : "playVideo"); }, [player.paused, player.status, youtube]);
  // Follow seeks: nudge the embed when the stub's clock jumps.
  const last = useRef(player.position);
  useEffect(() => { if (youtube && Math.abs(player.position - last.current) > 3) send("seekTo", [player.position, true]); last.current = player.position; }, [player.position]);
  // No picture yet while loading or reconnecting, and none after a failure.
  if (player.mode === "audio" || !current || (!youtube && !twitch) || ["loading", "retrying", "error"].includes(player.status)) return null;
  const src = youtube
    ? `https://www.youtube-nocookie.com/embed/${youtube}?autoplay=1&mute=1&controls=0&disablekb=1&modestbranding=1&rel=0&iv_load_policy=3&playsinline=1&enablejsapi=1&start=${start.current}`
    : `https://player.twitch.tv/?channel=${twitch}&parent=localhost&muted=true&autoplay=true&controls=false`;
  return <div ref={box} className={`pointer-events-none absolute inset-0 overflow-hidden bg-black ${className}`} aria-hidden="true">
    <iframe ref={frame} key={current.entryId} src={src} title="" allow="autoplay; encrypted-media" tabIndex={-1}
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border-0" style={size} />
  </div>;
}

export const kindLabel: Record<Kind, string> = { video: "video", music: "music", live: "live", radio: "radio", list: "channel or series" };
