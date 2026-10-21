import { Skeleton } from "@/components/ui/skeleton";
import { artAspect, type ArtShape } from "@/art-shape";
import { cn } from "@/lib/utils";

// One line of type as a bar at its own height, so a skeleton row or tile is as tall as what replaces it.
const line = (height: string, bar: string) => <div className={cn("flex items-center", height)}><Skeleton className={bar} /></div>;
const rowArt = { video: "[--row-art:7rem]", square: "[--row-art:4rem]", round: "[--row-art:4rem]", poster: "[--row-art:2.75rem]" } as const satisfies Record<ArtShape, string>;

/** Cold reads only, in MediaRow's geometry (a compact row is its artwork's height). Cached content stays mounted while Query revalidates it. */
export function MediaRowsSkeleton({ compact = false, shape = compact ? "square" : "video", count = 5, label = "Loading items…" }: { compact?: boolean; shape?: ArtShape; count?: number; label?: string }) {
  return <div role="status" aria-label={label} className="@container border-t" data-loading="rows">
    <span className="sr-only">{label}</span>
    {Array.from({ length: count }, (_, index) => <div key={index} aria-hidden="true" className={cn("grid items-start border-b py-3", compact ? cn("gap-x-3 grid-cols-[var(--row-art)_minmax(0,1fr)]", rowArt[shape]) : "gap-x-4 grid-cols-[6rem_minmax(0,1fr)] @md:grid-cols-[8rem_minmax(0,1fr)]")}>
      <Skeleton className={cn("w-full rounded-none", artAspect[shape])} />
      <div className="grid gap-0.5 px-2 py-1.5">{line("h-6", "h-4 w-3/5 max-w-96")}{line("h-5", "h-3.5 w-2/5 max-w-64")}{!compact && line("h-7", "h-4 w-24")}</div>
    </div>)}
  </div>;
}

/** Direct children of Shelf's ordered list, in MediaTile's geometry: its artwork's height and a caption of two title lines and a meta line. */
export function MediaTilesSkeleton({ shape = "video", count = 6, fluid = false }: { shape?: ArtShape; count?: number; fluid?: boolean }) {
  return <>{Array.from({ length: count }, (_, index) => <li key={index} aria-hidden="true" className="grid shrink-0 content-start gap-3" data-loading="tile">
    <Skeleton className={cn("rounded-none", artAspect[shape], fluid ? "w-full" : { poster: "h-72", square: "h-48", video: "h-44", round: "h-40" }[shape])} />
    <div className="grid min-h-[4.375rem] content-start gap-0.5 px-1 pb-1">{line("h-[1.375rem]", "h-4 w-4/5")}{line("h-5", "h-3.5 w-3/5")}</div>
  </li>)}</>;
}

export function DetailSkeleton({ shape = "video", home = false }: { shape?: ArtShape; home?: boolean }) {
  return <div role="status" aria-label={home ? "Loading your Home…" : "Loading details…"} data-loading="details" className={cn("grid gap-x-8 gap-y-6 lg:gap-x-12", home ? "border-b pb-8 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:items-center md:pb-12" : shape === "video" ? "md:grid-cols-[minmax(0,min(42%,28rem))_minmax(0,1fr)]" : "md:grid-cols-[minmax(0,min(36%,18rem))_minmax(0,1fr)]")}>
    <Skeleton className={cn("rounded-none", home ? "h-56 md:h-80" : artAspect[shape], !home && (shape === "square" ? "max-w-64 md:max-w-72" : shape === "poster" && "max-w-48 md:max-w-64"))} />
    <div aria-hidden="true" className="grid content-start gap-4"><Skeleton className="h-10 w-4/5" /><Skeleton className="h-5 w-2/5" /><div className="mt-4 flex flex-wrap gap-2"><Skeleton className="h-11 w-28 max-md:w-full" /><Skeleton className="h-11 w-20" /><Skeleton className="h-11 w-20" /></div><Skeleton className="mt-4 h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div>
  </div>;
}

export function SettingsRowsSkeleton({ count = 3 }: { count?: number }) {
  return <div role="status" aria-label="Loading settings…" data-loading="settings" className="@container">
    {Array.from({length: count}, (_, index) => <div key={index} aria-hidden="true" className="grid gap-3 border-b py-4 @2xl:grid-cols-2"><div className="grid gap-2"><Skeleton className="h-5 w-36" /><Skeleton className="h-4 w-48 max-w-full" /></div><Skeleton className="h-11 w-40" /></div>)}
  </div>;
}
