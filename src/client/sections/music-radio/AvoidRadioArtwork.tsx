import { useState } from "react";
import { Radio } from "lucide-react";
import type { RadioProgrammeDetails, RadioStation } from "../../../shared/radio";

export function AvoidRadioArtwork({ station, programme, expanded = false }: { station: RadioStation; programme?: RadioProgrammeDetails; expanded?: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = programme?.artworkUrl || station.logoUrl;
  return src && !failed
    ? <img className={`${expanded ? "aspect-square w-full" : "aspect-video w-full"} rounded-lg bg-muted object-cover`} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className={`${expanded ? "aspect-square" : "aspect-video"} grid w-full place-items-center rounded-lg bg-muted text-primary`} aria-hidden="true"><Radio className="size-12" /></span>;
}
