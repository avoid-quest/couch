import { invoke } from "@tauri-apps/api/core";
import { isNativeHost } from "@/session/native-context";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const nativeHost = isNativeHost();
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

// The native player draws video behind the WebView inside this rectangle.
export function VideoStage({ active, audioOnly = false }: { active: boolean; audioOnly?: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!nativeHost || !element.current) return;
    let frame = 0;
    let disposed = false;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!element.current) return;
        const { x, y, width, height } = element.current.getBoundingClientRect();
        void invoke("set_video_rect", { rect: { x, y, width, height } }).then(() => {
          if (!disposed) setError(null);
        }).catch((reason) => {
          if (!disposed) setError(errorText(reason));
        });
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element.current);
    const main = document.getElementById("main");
    if (main) observer.observe(main);
    window.addEventListener("resize", measure);
    window.addEventListener("couch-interface-size-applied", measure);
    window.addEventListener("scroll", measure, true);
    measure();
    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("couch-interface-size-applied", measure);
      window.removeEventListener("scroll", measure, true);
      void invoke("set_video_rect", { rect: { x: 0, y: 0, width: 0, height: 0 } }).catch(console.warn);
    };
  }, []);

  // .video-stage and .has-video are global hooks: index.css clears the page behind native video.
  return (
    <div ref={element} className={cn("video-stage absolute inset-0 grid place-items-center", nativeHost && active && !audioOnly && "has-video")} aria-label="Video playback">
      {error && <p role="status" className="grid max-w-md gap-1 px-(--gutter) pb-48 text-center"><span className="text-2xl font-semibold tracking-tight break-words">Can't show video</span><span className="text-sm text-muted-foreground">{error}</span></p>}
    </div>
  );
}
