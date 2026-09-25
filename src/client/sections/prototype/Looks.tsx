// PROTOTYPE — throwaway. The Clock look for the shared Couch layout: every length is
// drawn to one scale and read as the time it ends. (Colour and Focus were dropped.)
import { clock, smallArt, splitTitle, useProto, type Hit } from "./proto-data";
import { Actions, at, meta, useCouch, useNow, type Look, type ResultsProps } from "./Couch";

// Bars share a log scale from "now" to four hours out, so a 2-minute track and a
// 3-hour stream are told apart at a glance.
const horizon = 4 * 3600;
const scale = (seconds: number) => Math.max(.03, Math.log1p(seconds / 60) / Math.log1p(horizon / 60));

function ClockResults({ hits, ruler }: ResultsProps) {
  const now = useNow();
  const { player } = useProto();
  const { watch, open } = useCouch();
  // Bars live in a shared track that leaves room for the end-time label.
  const track = "relative mr-[11rem]";
  return <div className="grid grid-cols-[7rem_1fr_auto] gap-x-[1.2rem]">
    {ruler && <><div className="col-start-2 mb-[.4rem] h-[1.3rem] border-b border-[var(--line)] text-[.75rem] tabular-nums opacity-50"><div className={`${track} h-full`}>
      {[0, 600, 3600, 3 * 3600].map(t => <span key={t} className="absolute bottom-[.25rem] whitespace-nowrap border-l border-current pl-[.3rem]" style={{ left: `${t ? scale(t) * 100 : 0}%` }}>{t ? at(now + t * 1000) : `Now ${at(now)}`}</span>)}
    </div></div><div /></>}
    {hits.map(hit => {
      const { title } = splitTitle(hit);
      const left = hit.duration != null ? hit.duration - (hit.position ?? 0) : null;
      const label = left == null ? hit.kind === "list" ? "Channel" : "Live"
        : hit.position ? `Resume at ${clock(hit.position)}, ${clock(left)} left, ends ${at(now + left * 1000)}`
        : `${clock(hit.duration)}, ends ${at(now + left * 1000)}`;
      const width = hit.duration != null ? scale(hit.duration) * 100 : 0;
      return <div key={hit.id} data-hit-id={hit.id} className="group col-span-3 grid grid-cols-subgrid items-center py-[.5rem]">
        <span className="aspect-video w-full overflow-hidden bg-[var(--line)]">{hit.art && <img src={hit.kind === "radio" ? hit.art : smallArt(hit)} alt="" className={`size-full ${hit.kind === "radio" ? "object-contain p-[.4rem]" : "object-cover"}`} />}</span>
        <button data-play aria-label={`${hit.position ? "Resume" : hit.kind === "list" ? "Open" : "Play"} ${title}`} className="min-w-0 rounded-[.2rem] px-[.4rem] py-[.3rem] text-left outline-none focus-visible:bg-[var(--focus)] focus-visible:text-[var(--focus-ink)]" onClick={() => { if (hit.kind === "list") open(hit); else { player.playNow(hit); watch(); } }}>
          <span className="flex items-baseline gap-[.8rem]"><span className="truncate text-[1.1rem] font-medium">{title}</span><span className="shrink-0 truncate text-[.85rem] opacity-60">{meta(hit)}</span></span>
          <span className={`${track} mt-[.45rem] flex h-[.45rem] items-center`}>
            {width > 0 && <span className="relative h-full shrink-0 bg-current opacity-80" style={{ width: `${width}%` }}>
              {/* What's already watched stays as a faint stub of the same bar. */}
              {hit.position ? <span className="absolute inset-y-0 left-0 bg-[var(--ground)] opacity-60 group-has-[[data-play]:focus-visible]:bg-[var(--focus)]" style={{ width: `${hit.position / hit.duration! * 100}%` }} /> : null}
            </span>}
            <span className="absolute ml-[.6rem] whitespace-nowrap text-[.8rem] tabular-nums opacity-70" style={{ left: `${width}%` }}>{label}</span>
          </span>
          {hit.description && <span className="mt-[.5rem] hidden max-w-[60ch] overflow-hidden text-[.85rem] leading-snug opacity-70 [-webkit-box-orient:vertical] [-webkit-line-clamp:2] group-focus-within:[display:-webkit-box]">{hit.description}</span>}
        </button>
        <Actions hit={hit} compact className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" />
      </div>;
    })}
  </div>;
}

export const clockLook: Look = {
  name: "clock",
  font: "'Inter Tight', 'Inter Variable', sans-serif",
  vars: { "--ground": "#000", "--ink": "#fff", "--line": "rgb(255 255 255 / .2)", "--band": "#000", "--band-ink": "#fff", "--panel": "#000", "--focus": "#fff", "--focus-ink": "#000" } as React.CSSProperties,
  Results: ClockResults,
};

