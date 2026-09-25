// PROTOTYPE — throwaway. Floating variant switcher; never ships (dev builds only).
import { useEffect, useState } from "react";
import { useProto } from "./proto-data";

type Props = { variants: { key: string; name: string }[]; current: string; screen: "tv" | "desktop"; onVariant: (key: string) => void; onScreen: (screen: "tv" | "desktop") => void };

export function PrototypeSwitcher({ variants, current, screen, onVariant, onScreen }: Props) {
  const index = Math.max(0, variants.findIndex(v => v.key === current));
  const [shown, setShown] = useState(true);
  const step = (delta: number) => onVariant(variants[(index + delta + variants.length) % variants.length]!.key);
  useEffect(() => {
    // Arrows are the D-pad here, so the switcher uses Alt+arrows or [ and ].
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "[" || (event.altKey && event.key === "ArrowLeft")) { event.preventDefault(); step(-1); }
      if (event.key === "]" || (event.altKey && event.key === "ArrowRight")) { event.preventDefault(); step(1); }
      if (event.key === "\\") { event.preventDefault(); setShown(value => !value); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  const { player, app, setApp, remoteActs } = useProto();
  if (import.meta.env.PROD || !shown) return null;
  // Jump the simulated player to each kind of media and state every variant must handle.
  const pick = (kind: string) => player.entries.find(e => e.kind === kind);
  const media = [
    ["Video", () => { const e = player.entries.find(e => e.kind === "video" && /daddy|vordhosbn|windowlicker|rubber/i.test(e.title)) ?? pick("video"); if (e) player.play(e.entryId); }, player.mode === "video" && !player.status.match(/loading|buffering|retrying|error/)],
    ["Music", () => { const e = pick("music"); if (e) player.play(e.entryId); }, player.current?.kind === "music"],
    ["Radio", () => { const e = pick("radio"); if (e) player.play(e.entryId); }, player.current?.kind === "radio" && player.status !== "retrying"],
    ["Live", () => { const e = pick("live"); if (e) player.play(e.entryId); }, player.mode === "live"],
    ["Loading", () => player.setOverride("loading"), player.status === "loading"],
    ["Buffering", () => player.setOverride("buffering"), player.status === "buffering"],
    ["Retrying", () => { const e = pick("radio"); if (e) player.play(e.entryId); setTimeout(() => player.setOverride("retrying")); }, player.status === "retrying"],
    ["Error", () => player.setOverride("error"), player.status === "error"],
    ["Nothing", () => player.stop(), !player.current],
  ] as const;
  const pill = "h-[34px] px-[12px] rounded-full text-[13px] font-medium";
  return <div style={{ fontFamily: "system-ui", zIndex: 1000 }} className="group fixed top-[10px] left-1/2 flex -translate-x-1/2 items-center opacity-35 transition-opacity hover:opacity-100 gap-[4px] rounded-full bg-[#fff] p-[4px] text-[#000] shadow-[0_6px_30px_rgba(0,0,0,.45)] ring-1 ring-black/10" data-tv-local-only tabIndex={-1}>
    <button tabIndex={-1} className={pill} onClick={() => step(-1)} aria-label="Previous variant">‹</button>
    <span className="min-w-[110px] text-center text-[13px]"><b>{variants[index]!.key}</b> · {variants[index]!.name}</span>
    <button tabIndex={-1} className={pill} onClick={() => step(1)} aria-label="Next variant">›</button>
    {/* Collapsed to a small pill so it never covers the app; hover to expand. */}
    <div className="hidden items-center group-hover:flex">
    <span className="mx-[4px] h-[20px] w-px bg-black/15" />
    {media.map(([label, run, on]) => <button tabIndex={-1} key={label} className={`h-[34px] rounded-full px-[9px] text-[12px] ${on ? "bg-[#000] text-[#fff]" : ""}`} onClick={run}>{label}</button>)}
    <span className="mx-[4px] h-[20px] w-px bg-black/15" />
    {([["Controller", app.role === "controller", () => setApp({ ...app, role: app.role === "admin" ? "controller" : "admin" })],
      ["Offline", app.connection !== "online", () => setApp({ ...app, connection: app.connection === "online" ? "reconnecting" : "online" })],
      ["First run", app.welcome, () => setApp({ ...app, welcome: !app.welcome })],
      ["Fresh", app.fresh, () => setApp({ ...app, fresh: !app.fresh })],
      ["Someone acts", false, remoteActs]] as const).map(([label, on, run]) =>
      <button tabIndex={-1} key={label} className={`h-[34px] rounded-full px-[9px] text-[12px] ${on ? "bg-[#000] text-[#fff]" : ""}`} onClick={run}>{label}</button>)}
    <span className="mx-[4px] h-[20px] w-px bg-black/15" />
    {(["desktop", "tv"] as const).map(value => <button tabIndex={-1} key={value} className={`${pill} ${screen === value ? "bg-[#000] text-[#fff]" : ""}`} onClick={() => onScreen(value)}>{value === "tv" ? "TV 1080p" : "Desktop"}</button>)}
    </div>
  </div>;
}
