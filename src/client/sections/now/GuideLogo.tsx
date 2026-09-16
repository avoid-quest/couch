import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Tv } from "lucide-react";
import type { GuideChannel } from "../../../shared/iptv";
import type { Credentials } from "../../session/session";
import { apiFetch } from "../../api/client";

// Logos are immutable media reads; a failed URL falls back to the TV glyph.
export function GuideLogo({ credentials, channel }: { credentials: Credentials; channel: GuideChannel }) {
  const [fallback, setFallback] = useState(false);
  const { data: logo } = useQuery({
    queryKey: ["iptv", "logo", channel.id],
    enabled: channel.hasLogo,
    staleTime: Infinity,
    queryFn: () => apiFetch(credentials, `/api/iptv/channels/${channel.id}/logo`).then(r => r.blob()),
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!logo) return;
    const objectUrl = URL.createObjectURL(logo);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [logo]);
  return <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-primary" aria-hidden="true">
    {channel.hasLogo && url && !fallback ? <img src={url} alt="" className="size-full object-contain" onError={() => setFallback(true)} /> : <Tv />}
  </span>;
}
