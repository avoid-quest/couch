// PROTOTYPE — throwaway. Everything around the player and Find: navigation, where
// playback happens, pairing, Saved, Settings, first run and connection states.
// Settings pages mirror the real ones (sections/settings/**) as static fixtures.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, Pause, Play } from "lucide-react";
import { clock, splitTitle, useProto, type Hit } from "./proto-data";
import { at, button, downToRows, useNow, type Look } from "./Couch";

export type Page = "find" | "saved" | "settings";
export type Overlay = "device" | "pair" | null;

// ---- top bar --------------------------------------------------------------------------------
export function TopBar({ page, onPage, overlay, onOverlay }: { page: Page; onPage: (page: Page) => void; overlay: Overlay; onOverlay: (overlay: Overlay) => void }) {
  const { app } = useProto();
  const now = useNow();
  const tab = (value: Page, label: string) => <button className={`${button} text-[1rem] ${page === value ? "shadow-[inset_0_-.14rem_0_currentColor]" : "opacity-55"}`} aria-current={page === value ? "page" : undefined} onClick={() => onPage(value)}>{label}</button>;
  // Down from the bar lands at the top of the page, not on whatever is nearest.
  const down = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" || (event.target as HTMLElement).closest("[data-overlay]")) return;
    const first = [...document.querySelectorAll<HTMLElement>("[data-page-first]")].find(e => e.getClientRects().length);
    if (first) { event.preventDefault(); first.focus(); }
  };
  return <div data-topbar className="relative flex items-center gap-[.2rem] px-[2.2rem] pt-[1.4rem]" onKeyDown={down}>
    {tab("find", "Find")}{tab("saved", "Saved")}{tab("settings", "Settings")}
    <div className="ml-auto flex items-center gap-[.2rem]">
      <button className={button} data-overlay-trigger="device" aria-expanded={overlay === "device"} onClick={() => onOverlay(overlay === "device" ? null : "device")}>
        <span className={`size-[.5rem] rounded-full border border-current ${app.connection === "online" ? "bg-current" : ""}`} />{app.host === app.self ? "Playing here" : `Playing on ${app.host}`}
      </button>
      {app.role === "admin" && <button className={button} data-overlay-trigger="pair" onClick={() => onOverlay("pair")}>Pair a remote</button>}
      <span data-clock className="ml-[.8rem] text-[1rem] tabular-nums">{at(now)}</span>
    </div>
    {overlay === "device" && <DevicePopover onClose={() => onOverlay(null)} onSettings={() => { onOverlay(null); onPage("settings"); }} />}
  </div>;
}

/** Where playback happens, and how it sounds. One place for both. */
function DevicePopover({ onClose, onSettings }: { onClose: () => void; onSettings: () => void }) {
  const { app, setApp, player } = useProto();
  const [choice, setChoice] = useState<string | null>(null);
  const [output, setOutput] = useState("HDMI, LG TV");
  const devices = [app.self, ...["Living room", "Kitchen", "Studio Mac"].filter(d => d !== app.self)];
  const [address, setAddress] = useState("");
  const option = (selected: boolean, label: ReactNode, onClick: () => void, key: string) =>
    <button key={key} className={`${button} w-full justify-start`} aria-pressed={selected} onClick={onClick}><Check className={`size-[1em] ${selected ? "" : "invisible"}`} />{label}</button>;
  return <div data-overlay data-tv-navigation-scope className="absolute top-[3.6rem] right-[2.2rem] z-20 w-[26rem] border border-[var(--line)] bg-[var(--panel)] p-[1rem]">
    {choice ? <>
      <p className="px-[.8rem] text-[1.1rem] font-medium">Switch to {choice}?</p>
      <p className="mt-[.4rem] px-[.8rem] text-[.9rem] opacity-65">{player.current ? `${splitTitle(player.current).title} stops here. ` : ""}Remotes paired with {app.host} disconnect.</p>
      <div className="mt-[1rem] flex gap-[.3rem]">
        <button className={`${button} border border-current`} onClick={() => { setApp({ ...app, host: choice }); if (player.current) player.stop(true); onClose(); }}>Stop and switch</button>
        <button className={button} data-back onClick={() => setChoice(null)}>Keep {app.host}</button>
      </div>
    </> : <>
      <h2 className="mb-[.3rem] px-[.8rem] text-[.8rem]! font-normal! tracking-normal! opacity-60">Play on</h2>
      {devices.map(d => option(app.host === d, <span className="flex w-full justify-between">{d}<span className="opacity-50">{d === app.self ? "Here" : `${d.toLowerCase().replace(/\s+/g, "-")}.local`}</span></span>, () => d !== app.host && setChoice(d), d))}
      <label className="mt-[.2rem] flex items-center gap-[.4rem] px-[.8rem]">
        <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Another Couch address" aria-label="Another Couch address" className="h-[2.3rem] min-w-0 flex-1 border-b border-[var(--line)] bg-transparent text-[.9rem] outline-none focus:border-current" />
        <button className={button} disabled={!address} onClick={() => setChoice(address)}>Connect</button>
      </label>
      <h2 className="mt-[1.2rem] mb-[.3rem] px-[.8rem] text-[.8rem]! font-normal! tracking-normal! opacity-60">Sound on {app.host}</h2>
      {["HDMI, LG TV", "Speakers", "AirPods Pro"].map(o => option(output === o, o, () => setOutput(o), o))}
      <div className="flex items-center gap-[.3rem] px-[.8rem] pt-[.3rem]">
        <span className="mr-auto">Volume</span>
        <button className={button} onClick={() => player.setVolume(v => Math.max(0, v - 5))}>−</button>
        <span className="w-[3rem] text-center tabular-nums">{player.volume}</span>
        <button className={button} onClick={() => player.setVolume(v => Math.min(100, v + 5))}>+</button>
      </div>
      <button className={`${button} mt-[.6rem] opacity-70`} onClick={onSettings}>Sound settings</button>
    </>}
  </div>;
}

export function PairDialog({ onClose }: { onClose: () => void }) {
  // A stand-in QR: the real one encodes the address with #pair=<code>.
  const cells = Array.from({ length: 21 * 21 }, (_, i) => { const x = i % 21, y = Math.floor(i / 21), finder = (a: number, b: number) => x >= a && x < a + 7 && y >= b && y < b + 7; return finder(0, 0) || finder(14, 0) || finder(0, 14) ? !(x % 20 > 0 && x % 20 < 6 && y % 20 > 0 && y % 20 < 6) || (x % 20 > 1 && x % 20 < 5 && y % 20 > 1 && y % 20 < 5) : (x * 7 + y * 13 + x * y) % 3 === 0; });
  return <div data-overlay className="absolute inset-0 z-30 grid place-items-center bg-[rgb(0_0_0/.7)]">
    <div data-tv-navigation-scope className="flex w-[40rem] gap-[2rem] border border-[var(--line)] bg-[var(--panel)] p-[2rem]">
      <div className="grid size-[12rem] shrink-0 grid-cols-[repeat(21,1fr)] bg-white p-[.6rem]">{cells.map((on, i) => <span key={i} className={on ? "bg-black" : ""} />)}</div>
      <div className="flex min-w-0 flex-col">
        <h2 className="text-[1.5rem]! font-semibold! tracking-normal!">Pair a remote</h2>
        <p className="mt-[.5rem] text-[.95rem] opacity-70">Scan with a phone on the same network, or open the address and type the code.</p>
        <p className="mt-[1.2rem] text-[1rem]">http://couch.local:4100</p>
        <p className="mt-[.3rem] text-[2.6rem] font-semibold tabular-nums tracking-[.08em]">638 128</p>
        <button className={`${button} mt-auto self-start border border-current`} data-back onClick={onClose}>Done</button>
      </div>
    </div>
  </div>;
}

export function Banner() {
  const { app } = useProto();
  if (app.connection === "online") return null;
  return <div className="mx-[3rem] mt-[.8rem] flex items-center gap-[1rem] border border-[var(--line)] px-[1rem] py-[.6rem] text-[.95rem]">
    Reconnecting to {app.host}. Browsing and the queue come back when it answers.
  </div>;
}

/** What's playing, one step away from every page. */
export function MiniPlayer({ onResume }: { onResume: () => void }) {
  const { player, app } = useProto();
  const now = useNow();
  const current = player.current;
  if (!current) return null;
  const remaining = current.duration != null ? (current.duration - player.position) / player.speed : null;
  return <div data-mini style={{ "--progress": `${current.duration ? player.position / current.duration * 100 : 100}%`, viewTransitionName: "now" } as React.CSSProperties} className="relative flex items-center gap-[.6rem] border-t border-[var(--line)] bg-[var(--ground)] px-[2.2rem] pt-[.5rem] pb-[1.1rem]">
    {remaining != null && <div className="absolute top-[-1px] left-0 h-[1px] bg-current" style={{ width: `${player.position / current.duration! * 100}%` }} />}
    <button className={`${button} w-[2.6rem] px-0`} aria-label={player.paused ? "Play" : "Pause"} onClick={player.toggle}>{player.paused ? <Play className="size-[1.1rem] fill-current" /> : <Pause className="size-[1.1rem] fill-current" />}</button>
    <span className="min-w-0 truncate font-medium">{splitTitle(current).title}</span>
    <span data-mini-time className="shrink-0 text-[.9rem] tabular-nums opacity-60">
      {player.status === "retrying" ? "Reconnecting" : player.status === "error" ? "Can't play" : remaining != null ? `${clock(player.position)} / ${clock(current.duration)}, ends ${at(now + remaining * 1000)}` : "Live"}
    </span>
    {app.host === app.self && app.self !== "Living room" && <span className="ml-auto flex items-center">
      <button className={`${button} w-[2.4rem] px-0`} aria-label="Volume down" onClick={() => player.setVolume(v => Math.max(0, v - 5))}>−</button>
      <span className="w-[5.5rem] text-center text-[.9rem] tabular-nums">Volume {player.volume}</span>
      <button className={`${button} w-[2.4rem] px-0`} aria-label="Volume up" onClick={() => player.setVolume(v => Math.min(100, v + 5))}>+</button>
    </span>}
    <button className={`${button} ${app.host === app.self && app.self !== "Living room" ? "" : "ml-auto"}`} onClick={onResume}>Resume</button>
  </div>;
}

/** What others did, and what you can take back. Never takes focus. */
export function Notices({ above }: { above: "band" | "mini" }) {
  const { notices, dismiss } = useProto();
  // Just above whatever sits at the bottom, so it covers neither the picture's centre nor the top bar.
  return <div aria-live="polite" className={`pointer-events-none absolute right-[3rem] z-40 flex w-[26rem] flex-col items-end gap-[.4rem] ${above === "band" ? "bottom-[12.5rem]" : "bottom-[4.6rem]"}`}>
    {notices.map(n => <div key={n.id} className="pointer-events-auto flex max-w-full items-center gap-[.6rem] border border-[var(--line)] bg-[var(--panel)] py-[.35rem] pr-[.35rem] pl-[1rem] text-[var(--band-ink)]">
      <span className="min-w-0 truncate text-[.95rem]">{n.text}</span>
      {n.undo && <button className={`${button} border border-current`} onClick={() => { n.undo!(); dismiss(n.id); }}>Undo</button>}
    </div>)}
  </div>;
}

// ---- first run ----------------------------------------------------------------------------------
export function Welcome() {
  const { app, setApp } = useProto();
  const [step, setStep] = useState<"where" | "pair" | "allow">("where");
  const [address, setAddress] = useState("");
  const field = "h-[3rem] w-full border-b border-current bg-transparent text-[1.4rem] outline-none placeholder:opacity-30";
  const done = () => setApp({ ...app, welcome: false, fresh: true });
  return <div data-tv-navigation-scope className="absolute inset-0 flex flex-col justify-center px-[8rem]">
    {step === "where" && <>
      <h1 className="text-[3rem] font-semibold tracking-[-.03em]">Where do you want to play?</h1>
      <div className="mt-[2rem] grid max-w-[48rem] grid-cols-2 gap-[2rem]">
        <button className={`${button} h-auto flex-col items-start border border-[var(--line)] p-[1.4rem] text-left`} onClick={() => setStep("allow")}>
          <span className="text-[1.4rem]">This computer</span><span className="text-[.95rem] font-normal whitespace-normal opacity-65">Play here. Phones can pair as remotes.</span>
        </button>
        <div className="border border-[var(--line)] p-[1.4rem]">
          <p className="text-[1.4rem] font-medium">Another Couch</p>
          <input className={`${field} mt-[.6rem] text-[1.1rem]`} value={address} onChange={e => setAddress(e.target.value)} placeholder="couch.local" aria-label="Couch address" />
          <button className={`${button} mt-[1rem] border border-current`} disabled={!address} onClick={() => setStep("pair")}>Connect</button>
        </div>
      </div>
    </>}
    {step === "allow" && <>
      <h1 className="text-[3rem] font-semibold tracking-[-.03em]">Allow remote control?</h1>
      <p className="mt-[.8rem] max-w-[40rem] text-[1.2rem] opacity-70">Phones and computers on this network can pair and control playback. You can change this in Settings, Connections.</p>
      <div className="mt-[2rem] flex gap-[.4rem]"><button className={`${button} border border-current`} onClick={done}>Allow remote control</button><button className={button} onClick={done}>Keep private</button></div>
    </>}
    {step === "pair" && <>
      <h1 className="text-[3rem] font-semibold tracking-[-.03em]">Pair with {address}</h1>
      <p className="mt-[.8rem] text-[1.2rem] opacity-70">Open Pair a remote on that Couch and type the code it shows.</p>
      <div className="mt-[2rem] grid max-w-[40rem] gap-[1.4rem]">
        <input className={field} defaultValue="Studio Mac" aria-label="Device name" />
        <input className={`${field} tracking-[.3em] tabular-nums`} placeholder="000000" inputMode="numeric" maxLength={6} aria-label="Pairing code" />
      </div>
      <div className="mt-[2rem] flex gap-[.4rem]"><button className={`${button} border border-current`} onClick={() => { setApp({ ...app, welcome: false, fresh: true, host: address }); }}>Connect</button><button className={button} data-back onClick={() => setStep("where")}>Back</button></div>
    </>}
  </div>;
}

// ---- saved ------------------------------------------------------------------------------------
export function Saved({ look }: { look: Look }) {
  const proto = useProto();
  const { player, app } = proto;
  const [tab, setTab] = useState<"later" | "lists" | "kept">("later");
  const media = proto.later.filter(h => h.kind === "video" || h.kind === "music");
  const kept = proto.later.filter(h => !media.includes(h));
  const [openList, setOpenList] = useState<string | null>(null);
  const list = proto.lists.find(l => l.id === openList);
  const now = useNow();
  const content = useRef<HTMLDivElement>(null);
  const opened = useRef<string | null>(null);
  // Keep D-pad focus on something real when a list opens or closes.
  useEffect(() => {
    const target = openList ? content.current?.querySelector<HTMLElement>("button:not(:disabled)") : opened.current ? content.current?.querySelector<HTMLElement>(`[data-list="${opened.current}"]`) : null;
    target?.focus(); opened.current = openList ?? opened.current;
  }, [openList]);
  const total = (items: Hit[]) => items.reduce((sum, h) => sum + (h.duration ?? 0), 0);
  const side = (value: typeof tab, label: string, count: number) =>
    <button className={`${button} w-full justify-start`} data-page-first={value === "later" || undefined} aria-pressed={tab === value} onClick={() => { setTab(value); setOpenList(null); }}>
      <Check className={`size-[1em] ${tab === value ? "" : "invisible"}`} />{label}<span className="ml-auto tabular-nums opacity-60">{count}</span></button>;
  return <div data-page className="absolute inset-0 grid grid-cols-[15rem_1fr] gap-[2rem] pt-[2rem] pr-[3rem] pl-[2.2rem]">
    <div>{side("later", "For later", media.length)}{side("kept", "Channels and stations", kept.length)}{side("lists", "Lists", proto.lists.length)}</div>
    <div ref={content} className="min-h-0 overflow-y-auto pb-[3rem]">
      <p className="mb-[1.2rem] text-[.9rem] opacity-60">Shared with everyone who uses {app.host}.</p>
      {tab === "later" && (media.length ? <look.Results hits={media} /> : <p className="text-[1.2rem] opacity-60">Nothing saved. Use Save on any result.</p>)}
      {tab === "kept" && (kept.length ? <look.Results hits={kept} /> : <p className="text-[1.2rem] opacity-60">Save a channel, playlist or station to find it here.</p>)}
      {tab === "lists" && !list && <>
        <button className={`${button} -ml-[.8rem] mb-[1rem]`} disabled={!player.upNext.length} onClick={() => proto.setLists(ls => [...ls, { id: `l${Date.now()}`, name: `Up next, ${at(now)}`, items: player.upNext }])}>Keep Up next as a list</button>
        {proto.lists.map(l => <button key={l.id} data-list={l.id} className={`${button} h-auto w-full justify-between py-[.8rem] text-[1.2rem]`} onClick={() => setOpenList(l.id)}>
          {l.name}<span className="text-[.9rem] tabular-nums opacity-60">{l.items.length} items, {clock(total(l.items))}</span></button>)}
      </>}
      {tab === "lists" && list && <>
        <div className="mb-[1rem] flex flex-wrap items-center gap-[.3rem]" onKeyDown={downToRows}>
          <button className={`${button} -ml-[.8rem]`} data-back onClick={() => setOpenList(null)}><ChevronLeft className="size-[1.1em]" />All lists</button>
          <h2 className="mr-auto text-[1.6rem]! font-semibold! tracking-normal!">{list.name}</h2>
          <button className={button} onClick={() => { list.items.forEach((h, i) => i ? player.addNext(h) : player.playNow(h)); }}>Play</button>
          <button className={button} onClick={() => list.items.forEach(h => player.addNext(h))}>Add to Up next</button>
          <button className={button} onClick={() => proto.setLists(ls => ls.map(l => l.id === list.id ? { ...l, items: player.upNext } : l))}>Update from Up next</button>
          <button className={button} onClick={() => { const before = proto.lists; proto.setLists(ls => ls.filter(l => l.id !== list.id)); setOpenList(null); proto.notify(`Deleted ${list.name}`, () => proto.setLists(before)); }}>Delete</button>
        </div>
        <look.Results hits={list.items} />
      </>}
    </div>
  </div>;
}

// ---- settings ------------------------------------------------------------------------------------
type Row = { label: string; value?: string; options?: string[]; actions?: string[]; note?: string };
type SettingsPage = { id: string; name: string; admin?: boolean; rows: Row[] };
const settings: { group: string; pages: SettingsPage[] }[] = [
  { group: "Playback", pages: [
    { id: "playback", name: "Playback", rows: [
      { label: "Video quality", options: ["1080p", "Best", "720p", "480p"] },
      { label: "Audio language", options: ["Original", "Italiano", "English"] },
      { label: "Subtitles", options: ["Automatic", "Off"] },
      { label: "Subtitle language", options: ["English", "Italiano"] },
      { label: "Speed", options: ["1×", "1.25×", "1.5×"] },
      { label: "Music volume levelling", options: ["Off", "Track", "Album"] },
    ] },
    { id: "appearance", name: "Appearance", rows: [
      { label: "Interface size", options: ["Default", "Larger", "Largest"], note: "Doesn't change video or subtitles." },
    ] },
  ] },
  { group: "Library", pages: [
    { id: "sources", name: "Sources", rows: [
      { label: "TV folders", value: "/media/films, 1,204 items, scanned 08:40", actions: ["Scan again", "Add folder"] },
      { label: "Jellyfin", value: "Not connected", actions: ["Connect"] },
      { label: "Live TV (IPTV)", value: "Not set up", actions: ["Import M3U and guide"] },
      { label: "Radio playlists", value: "avoid radio, built in", actions: ["Refresh", "Add playlist"] },
      { label: "StreamingCommunity", value: "streamingcommunity.example", actions: ["Change address"] },
      { label: "Film and series details", value: "TMDB token saved", actions: ["Clear token"] },
    ] },
  ] },
  { group: "This device", pages: [
    { id: "general", name: "General", rows: [
      { label: "Name", value: "Living room", actions: ["Rename"] },
      { label: "Start with the computer", options: ["On", "Off"] },
      { label: "Restart Couch", actions: ["Restart"], note: "Playback stops and remotes reconnect." },
    ] },
    { id: "sound", name: "Sound", admin: true, rows: [
      { label: "Output", options: ["HDMI, LG TV", "Speakers", "AirPods Pro"] },
      { label: "Audio delay", value: "0 ms", actions: ["−", "+"] },
      { label: "Test", actions: ["Play a test tone"] },
    ] },
    { id: "display", name: "Display", admin: true, rows: [
      { label: "Screen", options: ["LG TV, 3840×2160, 60 Hz", "LG TV, 1920×1080, 60 Hz"], note: "The new screen is kept only if you confirm within 20 seconds." },
      { label: "TV interface size", options: ["Default", "Larger", "Largest"] },
    ] },
  ] },
  { group: "Connections", pages: [
    { id: "connections", name: "Remotes", admin: true, rows: [
      { label: "Allow remote control", options: ["On", "Off"] },
      { label: "Pixel 8", value: "Administrator, seen now", actions: ["Make controller", "Remove"] },
      { label: "iPad", value: "Controller, 2 days ago", actions: ["Make administrator", "Remove"] },
      { label: "New remote", actions: ["Pair a remote"] },
    ] },
    { id: "bluetooth", name: "Bluetooth", admin: true, rows: [
      { label: "Bluetooth", options: ["On", "Off"] },
      { label: "AirPods Pro", value: "Connected, used for sound", actions: ["Disconnect", "Forget"] },
      { label: "Other devices", actions: ["Search"] },
    ] },
  ] },
  { group: "System", pages: [
    { id: "updates", name: "Updates", admin: true, rows: [
      { label: "Version", value: "0.42.1, up to date, checked 09:12", actions: ["Check now"] },
      { label: "Channel", options: ["Stable", "Preview"] },
      { label: "Install", options: ["When I choose", "When idle"] },
    ] },
    { id: "advanced", name: "Advanced", admin: true, rows: [
      { label: "Diagnostics", value: "Build, player, sources and recent errors", actions: ["Save diagnostics"] },
      { label: "Media tools", value: "yt-dlp 2026.09.01, ffprobe 7.1", actions: ["Check tools"] },
    ] },
  ] },
];

// What each action does in the prototype: some ask first, some report progress.
const risky = new Set(["Restart", "Remove", "Forget", "Disconnect", "Clear token"]);
const progress: Record<string, [string, string]> = {
  "Check now": ["Checking for updates", "Up to date, checked just now"],
  "Play a test tone": ["Playing a 3-second tone", "Test tone played"],
  "Scan again": ["Scanning, 312 of 1,204", "/media/films, 1,204 items, scanned just now"],
  "Refresh": ["Refreshing avoid radio", "avoid radio, 38 stations, refreshed just now"],
  "Save diagnostics": ["Saving", "Saved couch-diagnostics.json"],
  "Check tools": ["Checking tools", "yt-dlp 2026.09.01, ffprobe 7.1, all working"],
  "Search": ["Searching for 30 seconds", "Found Sonos Roam"],
};

export function Settings({ onPair, initial }: { onPair: () => void; initial?: string }) {
  const { app } = useProto();
  const controller = app.role !== "admin";
  // A controller keeps Remotes only to claim administration.
  const visible = settings.map(g => ({ ...g, pages: g.pages.filter(p => !controller || !p.admin || p.id === "connections") })).filter(g => g.pages.length);
  const [pageId, setPageId] = useState(initial ?? "playback");
  const page = visible.flatMap(g => g.pages).find(p => p.id === pageId) ?? visible[0]!.pages[0]!;
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  useEffect(() => { if (!countdown) return; const timer = setTimeout(() => setCountdown(c => c - 1), 1000); return () => clearTimeout(timer); }, [countdown]);
  const readOnly = controller && (page.id === "general" || page.id === "sources");
  const act = (key: string, action: string) => {
    if (action === "Pair a remote") return onPair();
    if (risky.has(action)) return setConfirm(`${key}:${action}`);
    const steps = progress[action];
    if (steps) { setValues(v => ({ ...v, [key]: steps[0] })); setTimeout(() => setValues(v => ({ ...v, [key]: steps[1] })), 2200); }
    if (action === "−" || action === "+") setValues(v => { const ms = parseInt(v[key] ?? "0") + (action === "+" ? 20 : -20); return { ...v, [key]: `${ms} ms` }; });
  };
  const rows = controller && page.id === "connections"
    ? [{ label: "Claim administration", value: "Type the administrator code shown on the TV, under Settings, Remotes.", actions: ["Claim"] } as Row]
    : page.rows;
  return <div data-page className="absolute inset-0 grid grid-cols-[15rem_1fr] gap-[2rem] pt-[2rem] pr-[3rem] pl-[2.2rem]">
    <div className="min-h-0 overflow-y-auto">{visible.map(g => <div key={g.group} className="mb-[1.2rem]">
      <h2 className="mb-[.2rem] px-[.8rem] text-[.8rem]! font-normal! tracking-normal! opacity-60">{g.group === "This device" ? app.host : g.group}</h2>
      {g.pages.map((p, i) => <button key={p.id} data-page-first={(g === visible[0] && i === 0) || undefined} className={`${button} w-full justify-start`} aria-pressed={p.id === page.id} onClick={() => { setPageId(p.id); setConfirm(null); }}>
        <Check className={`size-[1em] ${p.id === page.id ? "" : "invisible"}`} />{p.name}</button>)}
    </div>)}
      {controller && <p className="px-[.8rem] text-[.85rem] opacity-60">Sound, display, Bluetooth and updates are managed by an administrator.</p>}
    </div>
    <div className="min-h-0 overflow-y-auto pb-[3rem]">
      <h1 data-title className="mb-[1rem] text-[2rem] font-semibold tracking-[-.02em]">{page.name}</h1>
      {readOnly && <p className="mb-[1rem] opacity-60">Only an administrator can change these.</p>}
      {rows.map(row => {
        const key = `${page.id}.${row.label}`;
        const selected = chosen[key] ?? row.options?.[0];
        const asking = confirm?.startsWith(`${key}:`) ? confirm.slice(key.length + 1) : null;
        return <div key={row.label} data-row className="grid grid-cols-[16rem_1fr] items-baseline gap-[1rem] border-t border-[var(--line)] py-[.9rem]">
          <span className="text-[1.05rem]">{row.label}</span>
          <div className="flex flex-wrap items-baseline gap-x-[.2rem] gap-y-[.3rem]">
            {asking ? <>
              <span className="mr-[.8rem]">{asking === "Restart" ? "Playback stops and remotes reconnect." : `${asking} ${row.label}?`}</span>
              <button className={`${button} border border-current`} onClick={() => { setConfirm(null); setValues(v => ({ ...v, [key]: asking === "Restart" ? "Restarting, remotes will reconnect" : `${asking === "Remove" || asking === "Forget" ? "Removed" : "Done"}` })); }}>{asking}</button>
              <button className={button} onClick={() => setConfirm(null)}>Cancel</button>
            </> : <>
              {(values[key] ?? row.value) && <span className="mr-[.8rem] opacity-65">{values[key] ?? row.value}</span>}
              {row.label === "Claim administration" && <input aria-label="Administrator code" placeholder="10-digit code" className="mr-[.4rem] h-[2.3rem] w-[12rem] border-b border-[var(--line)] bg-transparent tracking-[.2em] outline-none focus:border-current" />}
              {row.options?.map(o => <button key={o} className={button} disabled={readOnly} aria-pressed={selected === o} onClick={() => { setChosen(c => ({ ...c, [key]: o })); if (page.id === "display" && row.label === "Screen" && o !== row.options![0]) setCountdown(20); }}>
                <Check className={`size-[1em] ${selected === o ? "" : "hidden"}`} />{o}</button>)}
              {!readOnly && row.actions?.map(a => <button key={a} className={`${button} border border-[var(--line)]`} onClick={() => act(key, a)}>{a}</button>)}
            </>}
            {page.id === "display" && row.label === "Screen" && countdown > 0 && <p className="flex w-full items-baseline gap-[.4rem] pt-[.3rem]">Keep this screen? Going back in {countdown} s.
              <button className={`${button} border border-current`} onClick={() => setCountdown(0)}>Keep this screen</button>
              <button className={button} onClick={() => { setCountdown(0); setChosen(c => ({ ...c, [key]: row.options![0]! })); }}>Go back</button></p>}
            {row.note && !asking && <p className="w-full text-[.85rem] opacity-55">{row.note}</p>}
          </div>
        </div>;
      })}
    </div>
  </div>;
}

/** Back from Saved or Settings goes to Find; overlays close first. */
export function usePageBack(active: boolean, onBack: () => void) {
  const back = useRef(onBack); back.current = onBack;
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("[data-overlay]")) return;
      event.preventDefault(); event.stopImmediatePropagation();
      // A page's own back (e.g. out of a list) comes before leaving the page.
      const local = document.querySelector<HTMLElement>("[data-page] [data-back]");
      if (local) local.click(); else back.current();
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [active]);
}
