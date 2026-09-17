import { useState } from "react";

export function MediaArtwork({ thumbnail, title, className = "" }: { thumbnail?: string; title: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  let src = "";
  try {
    const url = new URL(thumbnail ?? "");
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) src = url.href;
  } catch { /* Missing artwork uses the title initials. */ }
  return src && !failed
    ? <img className={`media-artwork bg-muted ${className}`} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className={`media-artwork artwork-placeholder bg-muted text-muted-foreground ${className}`} aria-hidden="true">{title.slice(0, 2).toUpperCase()}</span>;
}
