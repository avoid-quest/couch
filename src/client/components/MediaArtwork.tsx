import { useState } from "react";
import { cn } from "@/lib/utils";

export function MediaArtwork({ thumbnail, title, className = "" }: { thumbnail?: string; title: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  let src = "";
  try {
    const url = new URL(thumbnail ?? "");
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) src = url.href;
  } catch { /* Missing artwork uses the title initials. */ }
  return src && !failed
    ? <img className={cn("media-artwork block w-full aspect-video object-cover bg-muted", className)} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className={cn("media-artwork grid w-full aspect-video place-items-center bg-muted text-[28px] tracking-[3px] text-muted-foreground", className)} aria-hidden="true">{title.slice(0, 2).toUpperCase()}</span>;
}
