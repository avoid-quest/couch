// PROTOTYPE — throwaway. Round 2: ONE conventional layout (player + Find) shared by
// every variant. Variants only supply a Look: tokens plus how results are drawn.
// Every action, key and panel is identical across looks.
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type FC, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Captions, Check, ChevronLeft, Minus, Pause, Play, Plus, RotateCcw, RotateCw, Search, Settings2, SkipForward, ListVideo, Square, Volume2, VolumeX } from "lucide-react";
import { Banner, MiniPlayer, Notices, PairDialog, Saved, Settings, TopBar, usePageBack, Welcome, type Overlay, type Page } from "./Shell";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import type { ProviderPage } from "../../../shared/providers";
import { allKinds, allLengths, allSources, clock, HERE, provider, splitTitle, toggle, useProto, ProtoVideo, type Filters, type Hit, type Kind, type Length, type Source } from "./proto-data";

export type ResultsProps = { hits: Hit[]; ruler?: boolean };
export type Look = {
  name: string;
  font: string;
  /** Extra CSS scoped to [data-look="<name>"]. It may restyle, never restructure, the shared
   * markup via its markers: data-band, data-title, data-time, data-elapsed, data-ends,
   * data-topbar, data-clock, data-mini, data-search, data-label, data-sheet, data-row. */
  css?: string;
  /** CSS variables: --ground --ink --muted --line --band --band-ink --panel --focus --focus-ink */
  vars: CSSProperties;
  Results: FC<ResultsProps>;
};

type CouchApi = { watch: () => void; focusHit: (hit: Hit | null) => void; open: (hit: Hit) => void };
const CouchContext = createContext<CouchApi>(null!);
export const useCouch = () => useContext(CouchContext);

// ---- time ---------------------------------------------------------------------
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(timer); }, []);
  return now;
}
export const at = (time: number) => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
export const lengthLabel: Record<Length, string> = { short: "Under 10 min", episode: "10 min to 1 hour", long: "Over an hour" };
const kindName: Record<Kind, string> = { video: "Video", music: "Music", live: "Live", radio: "Radio", list: "Channels" };

// ---- shared bits -----------------------------------------------------------------------
const focusRing = "outline-none focus-visible:bg-[var(--focus)] focus-visible:text-[var(--focus-ink)]";
export const button = `inline-flex items-center justify-center gap-[.45rem] rounded-[.25rem] px-[.8rem] h-[2.3rem] text-[.9rem] font-medium whitespace-nowrap transition-colors hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)] disabled:opacity-35 ${focusRing}`;
export const iconButton = `inline-grid place-items-center rounded-full size-[2.8rem] transition-colors hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)] ${focusRing}`;

export const sourceName = (source?: Source) => source === "Folders" ? "TV folders" : source;
export function meta(hit: Hit) {
  const { artist } = splitTitle(hit);
  return [artist ?? hit.by, sourceName(hit.source)].filter(Boolean).join(", ");
}

/** Play / Play next / Queue — the only three things a result can do. */
export function Actions({ hit, className = "", compact = false }: { hit: Hit; className?: string; compact?: boolean }) {
  const { player, later, saveForLater, forgetProgress } = useProto();
  const { watch } = useCouch();
  const [done, setDone] = useState<"next" | "queued" | null>(null);
  const saved = later.some(h => h.id === hit.id);
  useEffect(() => { if (!done) return; const timer = setTimeout(() => setDone(null), 2500); return () => clearTimeout(timer); }, [done]);
  // The row ends here: Right on the last action shouldn't jump elsewhere on screen.
  return <div className={`flex items-center gap-[.25rem] ${className}`} onKeyDown={event => { if (event.key === "ArrowRight" && event.target === event.currentTarget.lastElementChild) event.preventDefault(); }}>
    {!compact && <button className={button} data-play onClick={() => { player.playNow(hit); watch(); }}><Play className="size-[1em] fill-current" />Play</button>}
    {hit.position ? <button className={button} onClick={() => { player.playNow({ ...hit, position: 0 }); watch(); }}>From start</button>
      : hit.kind !== "list" && <button className={button} onClick={() => { player.playNext(hit); setDone("next"); }}>{done === "next" ? <><Check className="size-[1em]" />Plays next</> : "Play next"}</button>}
    {hit.kind !== "list" && <button className={button} onClick={() => { player.addNext(hit); setDone("queued"); }}>{done === "queued" ? <><Check className="size-[1em]" />Queued</> : "Queue"}</button>}
    {hit.position ? <button className={button} onClick={() => forgetProgress(hit)}>Remove</button>
      : <button className={button} aria-pressed={saved} onClick={() => saveForLater(hit)}>{saved ? <><Check className="size-[1em]" />Saved</> : "Save"}</button>}
  </div>;
}

export function Duration({ hit }: { hit: Hit }) {
  if (hit.kind === "live" || hit.kind === "radio") return <span>Live</span>;
  return <span className="tabular-nums">{hit.duration != null ? clock(hit.duration) : hit.kind === "list" ? "Channel" : ""}</span>;
}

// ---- the app ---------------------------------------------------------------------------
export function Couch({ look, screen }: { look: Look; screen: "tv" | "desktop" }) {
  const proto = useProto();
  const { player, app } = proto;
  const [page, setPage] = useState<Page | "player">("player");
  const [last, setLast] = useState<Page>("find");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [, setFocused] = useState<Hit | null>(null);
  // This screen is a TV called Living room, or a computer called Studio Mac that plays itself.
  useEffect(() => { const self = screen === "tv" ? "Living room" : "Studio Mac"; proto.setApp(a => ({ ...a, self, host: self })); }, [screen]);
  const [settingsPage, setSettingsPage] = useState<string | undefined>();
  const showing = player.current ? page : page === "player" ? last : page;
  // One transition: the mini player grows into the player's band, and back.
  const transition = (change: () => void) => {
    const start = (document as Document & { startViewTransition?: (f: () => void) => unknown }).startViewTransition;
    if (start && !matchMedia("(prefers-reduced-motion: reduce)").matches) start.call(document, () => flushSync(change)); else change();
  };
  const go = (value: Page, fromPlayer = page === "player") => { const change = () => { setLast(value); setPage(value); setOverlay(null); }; if (fromPlayer) transition(change); else change(); };
  const [opened, setOpened] = useState<Hit | null>(null);
  const api: CouchApi = { watch: () => transition(() => { setPage("player"); setOverlay(null); }), focusHit: setFocused, open: hit => { setOpened(hit); go("find"); } };
  usePageBack(showing === "saved" || showing === "settings", () => go("find"));
  useEffect(() => {
    if (!overlay) return;
    // Overlays close first, and focus returns to what opened them.
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation();
      const was = overlay; setOverlay(null);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-overlay-trigger="${was}"]`)?.focus());
    };
    window.addEventListener("keydown", keydown, true);
    const first = setTimeout(() => document.querySelector<HTMLElement>("[data-overlay] button")?.focus(), 30);
    return () => { window.removeEventListener("keydown", keydown, true); clearTimeout(first); };
  }, [overlay]);
  return <CouchContext.Provider value={api}>
    <div data-couch data-look={look.name} className="absolute inset-0 overflow-hidden bg-[var(--ground)] text-[var(--ink)] antialiased"
      style={{ fontFamily: look.font, ...look.vars }}>
      <style>{`[data-couch] :focus { outline: none !important; } [data-couch]:has([data-sheet]) [aria-live] { right: 33rem; } ::view-transition-group(now) { animation-duration: .32s; animation-timing-function: cubic-bezier(.2,.8,.2,1); }${look.css ?? ""}`}</style>
      {app.welcome ? <Welcome /> : <>
        <Player active={showing === "player"} back={last} onBack={() => go(last)} />
        <div hidden={showing === "player"} className="absolute inset-0 grid grid-rows-[auto_1fr_auto]">
          <div><TopBar page={showing === "player" ? last : showing} onPage={go} overlay={overlay} onOverlay={setOverlay} /><Banner /></div>
          <div className="relative min-h-0">
            <Find active={showing === "find"} look={look} onResume={api.watch} opened={opened} onClose={() => setOpened(null)} onSources={() => { setSettingsPage("sources"); go("settings"); }} />
            {showing === "saved" && <Saved look={look} />}
            {showing === "settings" && <Settings key={settingsPage} initial={settingsPage} onPair={() => setOverlay("pair")} />}
          </div>
          <MiniPlayer onResume={api.watch} />
        </div>
        {overlay === "pair" && <PairDialog onClose={() => setOverlay(null)} />}
        <Notices above={showing === "player" ? "band" : "mini"} />
      </>}
    </div>
  </CouchContext.Provider>;
}

// ---- player ----------------------------------------------------------------------------
type Panel = "queue" | "tracks" | "settings";

function Player({ active, back, onBack }: { active: boolean; back: Page; onBack: () => void }) {
  const { player, app } = useProto();
  const onFind = onBack;
  const now = useNow();
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [muted, setMuted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const pinned = player.status !== "playing" || !!panel;
  const shown = chrome || pinned;
  const wake = () => { setChrome(true); clearTimeout(timer.current); timer.current = setTimeout(() => setChrome(false), 4000); };
  // After the band has left its inert state.
  const focusFirst = () => setTimeout(() => root.current?.querySelector<HTMLElement>('[role="slider"][tabindex="0"], [data-primary]')?.focus(), 60);
  useEffect(() => { if (active) { wake(); focusFirst(); } else setPanel(null); }, [active]);
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.ctrlKey || document.querySelector("[data-overlay]")) return;
      if (event.key === "Escape" || event.key === "BrowserBack") {
        // Back closes a panel, then leaves the player for Find. Playback continues.
        event.preventDefault(); event.stopImmediatePropagation();
        if (panel) { const was = panel; setPanel(null); requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-panel="${was}"]`)?.focus()); }
        else onFind();
        return;
      }
      // The first press while the controls are hidden only brings them back.
      const lost = !root.current?.contains(document.activeElement);
      if ((!shown || lost) && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation(); wake(); focusFirst(); return;
      }
      if (event.key === " " && !(event.target as HTMLElement).closest("button")) { event.preventDefault(); player.toggle(); }
      wake();
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  });
  const current = player.current;
  const { title, artist } = splitTitle(current);
  const remaining = current?.duration != null ? (current.duration - player.position) / player.speed : null;
  const following = player.upNext[0];
  const chapter = [...player.chapters].reverse().find(c => c.position <= player.position);
  const audio = player.mode === "audio";
  const open = (value: Panel) => { setPanel(value); requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("[data-sheet] button")?.focus()); };
  return <div ref={root} hidden={!active} className={`absolute inset-0 ${shown ? "" : "cursor-none"}`} onMouseMove={wake}>
    {/* Picture: untouched, never under a scrim. */}
    <div className="absolute inset-0" onClick={() => { if (!shown) wake(); else if (!audio) player.toggle(); }}>
      {current && app.host !== app.self ? <ElsewhereStage />
        : <>{current && !audio && <ProtoVideo />}{current && audio && <AudioStage />}</>}
    </div>
    {current && <StatusCard onFind={onFind} />}

    {/* The band: one solid strip, nothing else sits on the picture. */}
    <div data-band inert={!shown} style={{ "--progress": `${current?.duration ? player.position / current.duration * 100 : 100}%`, viewTransitionName: active ? "now" : undefined } as CSSProperties} className={`absolute inset-x-0 bottom-0 bg-[var(--band)] text-[var(--band-ink)] px-[3rem] pt-[1.2rem] pb-[1.5rem] transition-transform duration-300 ${shown ? "" : "translate-y-full"}`}>
      <div className="flex items-baseline gap-[1rem]">
        <button className={`${button} -ml-[.8rem] capitalize`} data-back onClick={onBack}><ChevronLeft className="size-[1.1em]" />{back}</button>
        <h1 data-title className="min-w-0 truncate text-[2.1rem] font-semibold leading-tight tracking-[-.02em]">{title}</h1>
        <span className="ml-auto shrink-0 text-[.95rem] opacity-65">{app.connection === "online" ? [artist, sourceName(current?.source), current && current.addedBy !== HERE && `started from ${current.addedBy}`].filter(Boolean).join(", ") : `Reconnecting to ${app.host}`}</span>
      </div>
      {current && <Timeline />}
      <div data-time className="mt-[.35rem] flex items-baseline justify-between text-[.9rem] tabular-nums">
        {player.mode === "video" || current?.kind === "music"
          ? <><span data-elapsed>{clock(player.position)}{chapter && <span className="opacity-65">&emsp;{chapter.title}</span>}</span><span><span className="opacity-65">−{clock(remaining)}</span>&ensp;<span data-ends>ends {at(now + (remaining ?? 0) * 1000)}</span></span></>
          : <><span>Live</span>
            <span className="opacity-65">{current?.kind === "radio" ? player.nowPlaying : "No end time"}</span></>}
      </div>
      <div className="mt-[.6rem] flex items-center gap-[.3rem]">
        <button className={iconButton} data-primary aria-label={player.paused ? "Play" : "Pause"} onClick={player.toggle}>
          {player.paused ? <Play className="size-[1.3rem] fill-current" /> : <Pause className="size-[1.3rem] fill-current" />}
        </button>
        {player.seekable && <>
          <button className={iconButton} aria-label="Back 10 seconds" onClick={() => player.skip(-10)}><RotateCcw className="size-[1.2rem]" /></button>
          <button className={iconButton} aria-label="Forward 10 seconds" onClick={() => player.skip(10)}><RotateCw className="size-[1.2rem]" /></button>
        </>}
        <button className={iconButton} aria-label="Next" disabled={!following} onClick={player.next}><SkipForward className="size-[1.2rem] fill-current" /></button>
        <button className={iconButton} aria-label="Stop" onClick={() => { player.stop(); onBack(); }}><Square className="size-[1.05rem] fill-current" /></button>
        <button className={`${button} ml-[1rem] min-w-0`} data-panel="queue" aria-pressed={panel === "queue"} onClick={() => open("queue")}>
          <ListVideo className="size-[1.1em] shrink-0" />
          {following ? <span className="truncate">Next: {splitTitle(following).title}<span className="opacity-65">{remaining != null && ` in ${clock(remaining)}`}{player.upNext.length > 1 && `, then ${player.upNext.length - 1} more`}</span></span> : <span className="opacity-65">Nothing next</span>}
        </button>
        <div className="ml-auto flex items-center gap-[.3rem]">
          <button className={button} aria-label={muted ? "Unmute" : "Mute"} onClick={() => setMuted(m => !m)}>{muted ? <VolumeX className="size-[1.1em]" /> : <Volume2 className="size-[1.1em]" />}<span className="tabular-nums">{muted ? "Muted" : player.volume}</span></button>
          {!audio && <button className={button} data-panel="tracks" aria-pressed={panel === "tracks"} onClick={() => open("tracks")}><Captions className="size-[1.1em]" />Audio & subtitles</button>}
          <button className={button} data-panel="settings" aria-pressed={panel === "settings"} onClick={() => open("settings")}><Settings2 className="size-[1.1em]" />Settings</button>
        </div>
      </div>
    </div>
    {panel && <Sheet panel={panel} onClose={() => { const was = panel; setPanel(null); requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-panel="${was}"]`)?.focus()); }} />}
  </div>;
}

function Timeline() {
  const { player } = useProto();
  const current = player.current!;
  if (!player.seekable) return <div className="mt-[1.7rem] h-[.3rem] bg-current" />;
  const duration = current.duration!;
  return <div className="mt-[.7rem]">
    <div role="slider" tabIndex={0} aria-label="Position" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.round(player.position)} aria-valuetext={`${clock(player.position)} of ${clock(duration)}`}
      className="group relative flex h-[1.4rem] cursor-pointer items-center outline-none"
      onKeyDown={event => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); player.skip(event.key === "ArrowLeft" ? -10 : 10); }
        if (event.key === "ArrowDown") { event.preventDefault(); event.currentTarget.closest("[data-band]")?.querySelector<HTMLElement>("[data-primary]")?.focus(); }
        if (event.key === "ArrowUp") event.preventDefault();
      }}
      onClick={event => { const box = event.currentTarget.getBoundingClientRect(); player.seek((event.clientX - box.left) / box.width * duration); }}>
      <div className="relative h-[.3rem] w-full bg-[color-mix(in_srgb,currentColor_22%,transparent)] transition-[height] group-hover:h-[.55rem] group-focus-visible:h-[.8rem]">
        <div className="absolute inset-y-0 left-0 bg-current" style={{ width: `${player.position / duration * 100}%` }} />
        {/* Chapters: gaps cut into the bar, only when the source provides them. */}
        {player.chapters.slice(1).map(c => <div key={c.position} className="absolute inset-y-0 w-[.2rem] bg-[var(--band)]" style={{ left: `${c.position / duration * 100}%` }} />)}
      </div>
    </div>
  </div>;
}

/** Controlling another Couch: the picture is over there, so say so plainly. */
function ElsewhereStage() {
  const { player, app } = useProto();
  const current = player.current!;
  return <div className="absolute inset-0 flex items-center gap-[3rem] px-[5rem] pb-[11rem]">
    {current.art && <img src={current.art} alt="" className="aspect-video h-[42%] shrink-0 object-cover opacity-80" />}
    <div className="min-w-0">
      <p className="text-[1.1rem] opacity-65">Playing on {app.host}</p>
      <p className="mt-[.5rem] text-[3rem] font-semibold leading-[1.05] tracking-[-.03em]">{splitTitle(current).title}</p>
      <p className="mt-[.8rem] text-[1.1rem] opacity-65">The picture and sound are on {app.host}. Everything here controls it.</p>
    </div>
  </div>;
}

function AudioStage() {
  const { player } = useProto();
  const current = player.current!;
  const { title, artist } = splitTitle(current);
  return <div className="absolute inset-0 flex items-center gap-[3rem] px-[5rem] pb-[11rem]">
    {current.art ? <img src={current.art} alt="" className="aspect-square h-[62%] shrink-0 object-cover" /> : <div className="aspect-square h-[62%] shrink-0 bg-[var(--line)]" />}
    <div className="min-w-0">
      <p className="text-[3.4rem] font-semibold leading-[1.02] tracking-[-.03em]">{current.kind === "radio" ? current.by ?? title : title}</p>
      <p className="mt-[.8rem] text-[1.3rem] opacity-65">{current.kind === "radio" ? title : artist}</p>
      {player.nowPlaying && <p className="mt-[2rem] text-[1.1rem]">Playing now: {player.nowPlaying}</p>}
    </div>
  </div>;
}

function StatusCard({ onFind }: { onFind: () => void }) {
  const { player } = useProto();
  const [left, setLeft] = useState(8);
  useEffect(() => { if (player.status !== "retrying") return; setLeft(8); const timer = setInterval(() => setLeft(v => Math.max(0, v - 1)), 1000); return () => clearInterval(timer); }, [player.status]);
  const current = player.current!;
  const card = (children: ReactNode) => <div className="absolute inset-x-0 top-0 bottom-[12rem] grid place-items-center"><div className="w-[34rem] bg-[var(--band)] p-[2rem] text-[var(--band-ink)]">{children}</div></div>;
  if (player.status === "loading") return card(<><p className="text-[1.5rem] font-semibold">Loading {splitTitle(current).title}</p><p className="mt-[.5rem] opacity-65">Asking {current.source} for the stream.</p><div className="mt-[1.2rem] h-[.2rem] overflow-hidden bg-[var(--line)]"><div className="h-full w-1/3 animate-[couch-load_1.2s_ease-in-out_infinite] bg-current" /></div><style>{"@keyframes couch-load{from{transform:translateX(-100%)}to{transform:translateX(300%)}}"}</style></>);
  if (player.status === "buffering") return <div className="absolute top-[2rem] left-[2.5rem] bg-[var(--band)] px-[1rem] py-[.5rem] text-[.9rem] text-[var(--band-ink)]">Buffering</div>;
  if (player.status === "retrying" && player.retry) return card(<><p className="text-[1.5rem] font-semibold">Reconnecting to {current.title}</p><p className="mt-[.5rem] opacity-65">Next try in {left} s. Attempt {player.retry.attempt} of {player.retry.maximum}.</p>
    <div className="mt-[1.4rem] flex gap-[.4rem]"><button className={`${button} border border-current`} data-primary onClick={() => player.play(current.entryId)}>Try now</button><button className={button} onClick={player.next}>Skip</button></div></>);
  if (player.status === "error") return card(<><p className="text-[1.5rem] font-semibold">{player.error}</p><p className="mt-[.5rem] opacity-65">{splitTitle(current).title} can't play.</p>
    <div className="mt-[1.4rem] flex gap-[.4rem]"><button className={`${button} border border-current`} data-primary onClick={() => player.play(current.entryId)}>Try again</button><button className={button} onClick={player.next}>Skip</button><button className={button} onClick={onFind}>Find something else</button></div></>);
  return null;
}

// ---- panels ------------------------------------------------------------------------------
function Sheet({ panel, onClose }: { panel: Panel; onClose: () => void }) {
  const { player } = useProto();
  const now = useNow();
  const title = { queue: "Up next", tracks: "Audio & subtitles", settings: "Settings" }[panel];
  const option = (selected: boolean, label: ReactNode, onClick: () => void, key?: string) =>
    <button key={key} className={`${button} w-full justify-start`} aria-pressed={selected} onClick={onClick}><Check className={`size-[1em] ${selected ? "" : "invisible"}`} />{label}</button>;
  const group = (name: string, children: ReactNode) => <div className="mt-[1.6rem]"><h2 className="mb-[.4rem] px-[.8rem] text-[.85rem]! font-normal! tracking-normal! opacity-65">{name}</h2>{children}</div>;
  const stepper = (name: string, value: string, step: (delta: number) => void) => <div className="flex items-center gap-[.3rem] px-[.8rem]">
    <span className="mr-auto">{name}</span>
    <button className={iconButton} aria-label={`${name} earlier`} onClick={() => step(-1)}><Minus className="size-[1rem]" /></button>
    <span className="w-[4.5rem] text-center tabular-nums">{value}</span>
    <button className={iconButton} aria-label={`${name} later`} onClick={() => step(1)}><Plus className="size-[1rem]" /></button>
  </div>;
  const seconds = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)} s`;
  const { setLists, saveForLater, later } = useProto();
  const [saved, setSaved] = useState<string[]>([]);
  const remember = (key: string) => setSaved(list => [...list, key]);
  const saveDefault = (key: string) => <button className={`${button} mt-[.2rem] w-full justify-start opacity-70`} onClick={() => remember(key)}>{saved.includes(key) ? <><Check className="size-[1em]" />Saved as default</> : "Save as default"}</button>;
  let queueEnd = now + ((player.current?.duration ?? player.position) - player.position) * 1000;
  return <div data-sheet data-tv-navigation-scope className="absolute inset-y-0 right-0 w-[30rem] overflow-y-auto bg-[var(--panel)] px-[2.2rem] py-[1.6rem] text-[var(--band-ink)]">
    <div className="flex items-center gap-[.4rem]"><button className={`${button} -ml-[.4rem]`} data-back onClick={onClose}><ChevronLeft className="size-[1.1em]" />Close</button><h2 className="text-[1.4rem]! font-semibold! tracking-normal!">{title}</h2></div>
    {panel === "queue" && <>
      <div className="mt-[1rem] flex gap-[.2rem]"><button className={button} disabled={!player.upNext.length} onClick={() => { setLists(ls => [...ls, { id: `l${Date.now()}`, name: `Up next, ${at(now)}`, items: player.upNext }]); remember("list"); }}>{saved.includes("list") ? <><Check className="size-[1em]" />Kept in Saved</> : "Keep as a list"}</button></div>
      {!player.upNext.length && <p className="mt-[1.6rem] px-[.8rem] opacity-65">Nothing queued. Use Queue on any result and it plays after this.</p>}
      {player.upNext.length > 0 && group(`${player.upNext.length} to play, done by ${at(player.upNext.reduce((end, e) => end + (e.duration ?? 0) * 1000, queueEnd))}`, player.upNext.map((entry, index) => {
        const starts = queueEnd; queueEnd += (entry.duration ?? 0) * 1000;
        return <div key={entry.entryId} className="group/row relative flex items-center gap-[.2rem] rounded-[.25rem] py-[.2rem] focus-within:bg-[color-mix(in_srgb,currentColor_8%,transparent)]">
          <button className={`${button} h-auto min-w-0 flex-1 flex-col items-start py-[.5rem] text-left`} onClick={() => player.play(entry.entryId)}>
            <span className="w-full truncate">{splitTitle(entry).title}</span>
            <span className="text-[.8rem] opacity-65">{[entry.duration == null ? "Live" : `${clock(entry.duration)}, starts ${at(starts)}`, entry.addedBy !== HERE && `added by ${entry.addedBy}`].filter(Boolean).join(", ")}</span>
          </button>
          <span className="flex opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-[:focus-visible]:opacity-100">
          {index > 0 && <button className={button} onClick={() => player.move(entry.entryId, player.upNext[index - 1]!.entryId)}>Earlier</button>}
          {index < player.upNext.length - 1 && <button className={button} onClick={() => player.move(entry.entryId, player.upNext[index + 2]?.entryId ?? null)}>Later</button>}
          <button className={button} aria-pressed={later.some(h => h.id === entry.id)} onClick={() => saveForLater(entry)}>{later.some(h => h.id === entry.id) ? "Saved" : "Save"}</button>
          <button className={button} onClick={() => player.remove(entry.entryId)}>Remove</button>
          </span>
        </div>;
      }))}
      {player.history.length > 0 && group("Played", [...player.history].reverse().map(entry =>
        <button key={entry.entryId} className={`${button} w-full justify-start opacity-65`} onClick={() => player.play(entry.entryId)}><span className="truncate">{splitTitle(entry).title}</span></button>))}
    </>}
    {panel === "tracks" && <>
      {group("Subtitles", <>{player.subtitleTracks.map(t => option(player.subtitles === t, t, () => player.setSubtitles(t), t))}
        <button className={`${button} w-full justify-start`}><Plus className="size-[1em]" />Add subtitle file</button>{saveDefault("subtitles")}</>)}
      {group("Audio", <>{player.audioTracks.map(t => option(player.audio === t, t, () => player.setAudio(t), t))}{saveDefault("audio")}</>)}
      {group("Timing", <>{stepper("Subtitles", seconds(player.subtitleDelay), d => player.setSubtitleDelay(v => Math.round((v + d * .1) * 10) / 10))}</>)}
    </>}
    {panel === "settings" && <>
      {player.chapters.length > 0 && group("Chapters", player.chapters.map(c => option([...player.chapters].reverse().find(x => x.position <= player.position) === c, <span className="flex w-full justify-between gap-[1rem]"><span className="truncate">{c.title}</span><span className="tabular-nums opacity-60">{clock(c.position)}</span></span>, () => player.seek(c.position), String(c.position))))}
      {player.seekable && group("Speed", <><div className="flex flex-wrap px-[.4rem]">{player.speeds.map(s => <button key={s} className={button} aria-pressed={player.speed === s} onClick={() => player.setSpeed(s)}>{player.speed === s && <Check className="size-[1em]" />}{s}×</button>)}</div>{saveDefault("speed")}</>)}
      {player.mode !== "audio" && group("Quality", player.qualities.map(q => option(player.quality === q, q, () => player.setQuality(q), q)))}
      {group("Volume levelling", (["Off", "Track", "Album"] as const).map(n => option(player.normalisation === n, n, () => player.setNormalisation(n), n)))}
      {group("Sound", <>
        {stepper("Volume", String(player.volume), d => player.setVolume(v => Math.max(0, Math.min(100, v + d * 5))))}
        {stepper("Audio timing", seconds(player.audioDelay), d => player.setAudioDelay(v => Math.round((v + d * .1) * 10) / 10))}
      </>)}
    </>}
  </div>;
}

// ---- find ---------------------------------------------------------------------------------
function Find({ active, look, onResume, opened, onClose, onSources }: { active: boolean; look: Look; onResume: () => void; opened: Hit | null; onClose: () => void; onSources: () => void }) {
  const proto = useProto();
  const { player, query, setQuery, filters, setFilters } = proto;
  const { focusHit } = useCouch();
  const now = useNow();
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const searching = proto.active;
  useEffect(() => {
    if (!active) { focusHit(null); return; }
    requestAnimationFrame(() => ((searching ? results.current?.querySelector<HTMLElement>("[data-play]") : null) ?? input.current)?.focus());
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.ctrlKey || document.querySelector("[data-overlay]")) return;
      const inInput = event.target === input.current;
      if (event.key === "Escape" || event.key === "BrowserBack") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (opened) { onClose(); requestAnimationFrame(() => results.current?.querySelector<HTMLElement>(`[data-hit-id="${CSS.escape(opened.id)}"] [data-play]`)?.focus()); }
        else if (inInput && query) setQuery("");
        else if (player.current) onResume();
        else input.current?.focus();
        return;
      }
      // Typing anywhere searches.
      if (!inInput && (event.key.length === 1 && !" \\[]".includes(event.key) || event.key === "Backspace")) input.current?.focus();
      // Arrows inside the field would only move the caret; Up reaches the top bar.
      if (inInput && event.key === "ArrowUp") { event.preventDefault(); document.querySelector<HTMLElement>('[aria-current="page"]')?.focus(); }
      if (inInput && (event.key === "ArrowDown" || event.key === "Enter")) {
        event.preventDefault();
        (results.current?.querySelector<HTMLElement>("[data-play]") ?? root.current?.querySelector<HTMLElement>("[data-filter]:not(:disabled)"))?.focus();
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  });
  const [notice, setNotice] = useState("");
  const link = /^https?:\/\/\S+$/i.test(query.trim()) ? query.trim() : null;
  const loadingSources = allSources.filter(s => proto.loading[s]);
  const facet = <K extends keyof Filters>(key: K, name: string, values: Filters[K][number][], label: (v: Filters[K][number]) => string) =>
    <div className="mb-[1.4rem]">
      <h2 data-label className="mb-[.3rem] px-[.8rem] text-[.8rem]! font-normal! tracking-normal! opacity-60">{name}</h2>
      <button data-filter className={`${button} w-full justify-start`} aria-pressed={!filters[key].length} disabled={!searching} onClick={() => setFilters({ ...filters, [key]: [] })}>
        <Check className={`size-[1em] ${filters[key].length ? "invisible" : ""}`} />All</button>
      {values.map(value => {
        const on = filters[key].includes(value as never);
        const count = proto.count(key, value as string);
        const waiting = key === "sources" && proto.loading[value as Source];
        // Sources without results aren't choices; other facets stay put so the layout doesn't jump.
        if (key === "sources" && !count && !on && !waiting) return null;
        return <button key={value} data-filter className={`${button} w-full justify-start`} aria-pressed={on} disabled={!searching || (!count && !on && !waiting)}
          onClick={() => setFilters({ ...filters, [key]: toggle(filters[key] as string[], value as string) })}>
          <Check className={`size-[1em] ${on ? "" : "invisible"}`} />{label(value)}
          <span className="ml-auto tabular-nums opacity-60">{!searching ? "" : waiting ? "…" : count}</span>
        </button>;
      })}
    </div>;
  return <div ref={root} hidden={!active} className="absolute inset-0 grid grid-rows-[auto_1fr]">
    <div className="flex items-end gap-[1.5rem] px-[3rem] pt-[1.6rem] pb-[1.2rem]">
      <label className="flex min-w-0 flex-1 items-center gap-[1rem] border-b-2 border-current pb-[.4rem]">
        <Search className="size-[1.8rem] shrink-0 opacity-60" />
        <input ref={input} data-page-first data-search value={query} onChange={event => setQuery(event.target.value)} aria-label="Search"
          placeholder="Search, or paste a link"
          className="min-w-0 flex-1 bg-transparent text-[2.4rem] font-medium tracking-[-.02em] outline-none placeholder:text-current placeholder:opacity-30" />
      </label>
      {searching && loadingSources.length ? <p className="shrink-0 pb-[.7rem] text-[.9rem] opacity-60">Still asking {loadingSources.join(", ")}</p>
        : <button className={`${button} mb-[.4rem] shrink-0`} onClick={() => setNotice("On the desktop app this opens the file picker. The file plays here.")}>Open file</button>}
    </div>

    {/* Filters shape search results only: not the home, a pasted link, or an opened channel. */}
    <div className={`grid min-h-0 gap-[2rem] pl-[2.2rem] pr-[3rem] ${searching && !opened && !link ? "grid-cols-[15rem_1fr]" : "grid-cols-1 pl-[3rem]"}`}>
      {searching && !opened && !link && <div className="min-h-0 overflow-y-auto pb-[2rem]">
        {facet("sources", "From", allSources, v => v === "Folders" ? "TV folders" : v)}
        {facet("kinds", "What", allKinds, v => kindName[v])}
        {facet("lengths", "Length", allLengths, v => lengthLabel[v])}
      </div>}
      <div ref={results} className="min-h-0 overflow-y-auto pb-[3rem] scroll-pt-[3rem]"
        onFocus={event => { const id = (event.target as HTMLElement).closest<HTMLElement>("[data-hit-id]")?.dataset.hitId; focusHit([...proto.visible, ...proto.continuing, ...proto.later].find(h => h.id === id) ?? null); }}>
        {notice && <p className="mb-[1rem] text-[.95rem] opacity-70">{notice}</p>}
        {opened ? <Collection hit={opened} look={look} onClose={onClose} />
        : link ? <LinkCard url={link} onPlay={onResume} />
        : searching
          ? proto.visible.length ? <look.Results hits={proto.visible} ruler />
            : proto.pending ? <p className="pt-[.6rem] text-[1.2rem] opacity-60">Searching</p>
            : proto.hits.length ? <p className="pt-[.6rem] text-[1.2rem]">Nothing matches these filters. <button className={`${button} underline`} onClick={() => setFilters({ sources: [], kinds: [], lengths: [] })}>Clear filters</button></p>
            : <Empty title={`Nothing found for “${query}”`} onSources={onSources}>Searched YouTube, Twitch, RaiPlay, radio and TV folders. Try fewer words, or paste a link to the page with the video.</Empty>
          // Home: only what's yours to pick up again. A fresh install says what to do first.
          : !proto.continuing.length && !proto.later.length ? <Empty title="Find something to play" onSources={onSources}>Search YouTube, Twitch, RaiPlay, radio stations and your TV folders at once, or paste a link from any page with video. What you don't finish shows up here to continue.</Empty>
          : <>
            {proto.continuing.length > 0 && <section className="mb-[2.4rem]"><h2 data-label className="mb-[.4rem] text-[.8rem]! font-normal! tracking-normal! opacity-60">Continue</h2><look.Results hits={proto.continuing} /></section>}
            {proto.later.some(h => h.kind === "video" || h.kind === "music") && <section><h2 data-label className="mb-[.4rem] text-[.8rem]! font-normal! tracking-normal! opacity-60">For later</h2><look.Results hits={proto.later.filter(h => h.kind === "video" || h.kind === "music")} /></section>}
          </>}
      </div>
    </div>
  </div>;
}

/** A pasted link: play it directly, as a page Couch reads, or queue it. */
function LinkCard({ url, onPlay }: { url: string; onPlay: () => void }) {
  const { player } = useProto();
  const [type, setType] = useState("Webpage");
  const [quality, setQuality] = useState("1080p");
  const hit: Hit = { id: url, source: "YouTube", kind: "video", title: new URL(url).hostname.replace(/^www\./, "") + new URL(url).pathname };
  const choice = (value: string, current: string, set: (v: string) => void) => <button key={value} className={button} aria-pressed={value === current} onClick={() => set(value)}>{value === current && <Check className="size-[1em]" />}{value}</button>;
  return <div className="max-w-[48rem] border-t border-[var(--line)] pt-[1rem]">
    <p className="truncate text-[1.3rem] font-medium">{url}</p>
    <div className="mt-[.8rem] flex items-center gap-[.2rem]"><span className="w-[6rem] opacity-60">Open as</span>{["Webpage", "Direct media"].map(v => choice(v, type, setType))}</div>
    {type === "Webpage" && <div className="flex items-center gap-[.2rem]"><span className="w-[6rem] opacity-60">Quality</span>{["1080p", "Best", "720p", "480p"].map(v => choice(v, quality, setQuality))}</div>}
    <div className="mt-[1rem] flex gap-[.2rem]"><button className={`${button} border border-current`} data-play onClick={() => { player.playNow(hit); onPlay(); }}><Play className="size-[1em] fill-current" />Play</button><button className={button} onClick={() => player.addNext(hit)}>Queue</button></div>
  </div>;
}

/** Down from a page header goes to its first row, not the nearest control on screen. */
export function downToRows(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown") return;
  const row = event.currentTarget.parentElement?.querySelector<HTMLElement>("[data-play]");
  if (row) { event.preventDefault(); row.focus(); }
}

/** Inside a channel, playlist or series: the provider's own items, same rows. */
function Collection({ hit, look, onClose }: { hit: Hit; look: Look; onClose: () => void }) {
  const { credentials, player } = useProto();
  const { watch } = useCouch();
  const id = ({ YouTube: "youtube", Twitch: "twitch", RaiPlay: "raiplay" } as Partial<Record<Source, string>>)[hit.source];
  const items = useQuery({ queryKey: ["proto", "collection", hit.url], enabled: !!id && !!hit.url, retry: false, staleTime: 600_000,
    queryFn: ({ signal }) => apiFetch(credentials, `/api/providers/${id}/items?${new URLSearchParams({ url: hit.url! })}`, { signal }, 30_000).then(r => r.json() as Promise<ProviderPage>).then(page => page.items.map(provider(hit.source))) });
  const playable = (items.data ?? []).filter(h => h.kind !== "list");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.querySelector<HTMLElement>("[data-back]")?.focus(); }, [hit.id]);
  return <div ref={root}>
    <div className="mb-[1rem] flex flex-wrap items-center gap-[.3rem]" onKeyDown={downToRows}>
      <button className={`${button} -ml-[.8rem]`} data-back onClick={onClose}><ChevronLeft className="size-[1.1em]" />Results</button>
      <h2 className="mr-auto min-w-0 truncate text-[1.6rem]! font-semibold! tracking-normal!">{splitTitle(hit).title}</h2>
      <button className={button} disabled={!playable.length} onClick={() => { playable.forEach((h, i) => i ? player.addNext(h) : player.playNow(h)); watch(); }}><Play className="size-[1em] fill-current" />Play all</button>
      <button className={button} disabled={!playable.length} onClick={() => playable.forEach(h => player.addNext(h))}>Queue all</button>
      <Actions hit={hit} compact />
    </div>
    {items.isPending ? <p className="opacity-60">Opening {hit.source}</p>
      : items.isError ? <p className="opacity-60">{hit.source} didn't answer. <button className={`${button} underline`} onClick={() => void items.refetch()}>Try again</button></p>
      : <look.Results hits={items.data ?? []} ruler />}
  </div>;
}

/** Emptiness points at the next step: search, paste, or (administrators) add a source. */
function Empty({ title, children, onSources }: { title: string; children: ReactNode; onSources: () => void }) {
  const { app } = useProto();
  const sources: [string, string][] = [["TV folders", "Not set up"], ["Jellyfin", "Not connected"], ["Live TV", "Not set up"], ["Radio", "avoid radio, built in"]];
  return <div className="max-w-[46rem] pt-[.6rem]">
    <p className="text-[1.6rem] font-semibold tracking-[-.02em]">{title}</p>
    <p className="mt-[.6rem] text-[1.05rem] leading-relaxed opacity-70">{children}</p>
    {app.role === "admin" ? <div className="mt-[2rem]">
      <p className="mb-[.3rem] text-[.9rem] opacity-60">Sources on {app.host}</p>
      {sources.map(([name, state]) => <div key={name} className="flex items-baseline gap-[1rem] border-t border-[var(--line)] py-[.5rem]"><span className="w-[10rem]">{name}</span><span className="opacity-60">{state}</span></div>)}
      <button className={`${button} mt-[.6rem] -ml-[.8rem] border border-current`} onClick={onSources}>Add a source</button>
    </div> : <p className="mt-[1.4rem] text-[.95rem] opacity-60">An administrator can add TV folders, Jellyfin or Live TV in Settings.</p>}
  </div>;
}
