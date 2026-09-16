import { useState } from "react";
import type { RadioStation } from "../../../shared/radio";

export function StationArtwork({ station }: { station: RadioStation }) {
  const [failed, setFailed] = useState(false);
  let src = "";
  try {
    const url = new URL(station.logoUrl ?? "");
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) src = url.href;
  } catch { /* A missing or invalid logo uses the station initials. */ }
  return src && !failed
    ? <img className="size-12 shrink-0 rounded-lg bg-muted object-contain" src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted text-base font-semibold text-primary" aria-hidden="true">{station.name.slice(0, 2).toUpperCase()}</span>;
}
