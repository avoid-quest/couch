import { Skeleton } from "@/components/ui/skeleton";
import { tileAspect, type TileShape } from "./MediaTile";
import { cn } from "@/lib/utils";

/** Cold reads only. Cached content stays mounted while Query revalidates it. */
export function MediaRowsSkeleton({ compact = false, count = 5, label = "Loading items…" }: { compact?: boolean; count?: number; label?: string }) {
  return <div role="status" aria-label={label} className="@container border-t" data-loading="rows">
    <span className="sr-only">{label}</span>
    {Array.from({ length: count }, (_, index) => <div key={index} aria-hidden="true" className={cn("grid items-start gap-4 border-b py-3", compact ? "grid-cols-[4rem_minmax(0,1fr)]" : "grid-cols-[6rem_minmax(0,1fr)] @md:grid-cols-[8rem_minmax(0,1fr)]")}>
      <Skeleton className={cn("rounded-none", compact ? "aspect-square" : "aspect-video")} />
      <div className="grid gap-3 px-2 py-2"><Skeleton className="h-5 w-3/5 max-w-96" /><Skeleton className="h-4 w-2/5 max-w-64" /><Skeleton className="my-2 h-4 w-24" /></div>
    </div>)}
  </div>;
}

/** Direct children of Shelf's ordered list, matching MediaTile's artwork and caption. */
export function MediaTilesSkeleton({ shape = "video", count = 6, fluid = false }: { shape?: TileShape; count?: number; fluid?: boolean }) {
  return <>{Array.from({ length: count }, (_, index) => <li key={index} aria-hidden="true" className="grid shrink-0 content-start gap-3" data-loading="tile">
    <Skeleton className={cn("rounded-none", tileAspect[shape], fluid ? "w-full" : shape === "poster" ? "h-72" : shape === "square" ? "h-48" : "h-44")} />
    <div className="grid gap-2 px-1 pb-1"><Skeleton className="h-5 w-4/5" /><Skeleton className="h-5 w-3/5" /><Skeleton className="h-4 w-2/3" /><Skeleton className="my-2 h-4 w-24" /></div>
  </li>)}</>;
}

export function DetailSkeleton({ shape = "video", home = false }: { shape?: TileShape; home?: boolean }) {
  return <div role="status" aria-label={home ? "Loading your Home…" : "Loading details…"} data-loading="details" className={cn("grid gap-x-8 gap-y-6 lg:gap-x-12", home ? "border-b pb-8 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:items-center md:pb-12" : shape === "video" ? "md:grid-cols-[minmax(0,min(42%,28rem))_minmax(0,1fr)]" : "md:grid-cols-[minmax(0,min(36%,18rem))_minmax(0,1fr)]")}>
    <Skeleton className={cn("rounded-none", home ? "h-56 md:h-80" : tileAspect[shape], !home && (shape === "square" ? "max-w-64 md:max-w-72" : shape === "poster" && "max-w-48 md:max-w-64"))} />
    <div aria-hidden="true" className="grid content-start gap-4"><Skeleton className="h-10 w-4/5" /><Skeleton className="h-5 w-2/5" /><div className="mt-4 flex flex-wrap gap-2"><Skeleton className="h-11 w-28 max-md:w-full" /><Skeleton className="h-11 w-20" /><Skeleton className="h-11 w-20" /></div><Skeleton className="mt-4 h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div>
  </div>;
}

export function SettingsRowsSkeleton({ count = 3 }: { count?: number }) {
  return <div role="status" aria-label="Loading settings…" data-loading="settings" className="@container">
    {Array.from({length: count}, (_, index) => <div key={index} aria-hidden="true" className="grid gap-3 border-b py-4 @2xl:grid-cols-2"><div className="grid gap-2"><Skeleton className="h-5 w-36" /><Skeleton className="h-4 w-48 max-w-full" /></div><Skeleton className="h-11 w-40" /></div>)}
  </div>;
}
