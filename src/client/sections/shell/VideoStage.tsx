import { invoke } from "@tauri-apps/api/core";
import { isNativeHost } from "@/session/native-context";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Music2 } from "lucide-react";
import { Icon } from "@/components/Icon";
import { useOptionalShell } from "@/sections/shell/shell-context";

const nativeHost = isNativeHost();
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function VideoStage({ active, title, audioOnly = false, subtitle, artwork }: {
  active: boolean;
  title: string;
  audioOnly?: boolean;
  subtitle?: string;
  artwork?: ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const controlsUp = useOptionalShell()?.tv.controlsVisible ?? false;
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

  return (
    <div ref={element} className={`video-stage${nativeHost && active && !audioOnly ? " has-video" : ""}${active && audioOnly ? " audio-stage" : ""}`} aria-label="Video playback">
      {active && audioOnly && !error ? (
        <div className="audio-stage-caption flex h-full w-full flex-nowrap items-center justify-center gap-16 px-[6vw]">
          <div className={`audio-stage-artwork h-[75%] max-h-[720px] w-auto shrink-0${artwork ? "" : " without-artwork"}`} aria-hidden="true">{artwork || <Music2 />}</div>
          {!controlsUp && <div className="audio-stage-copy min-w-0 flex-1"><p className="eyebrow">Listening now</p><h1>{title}</h1>{subtitle && <p className="audio-stage-track" role="status">{subtitle}</p>}</div>}
        </div>
      ) : (!active || error) && (
        <div className="stage-caption">
          <div className="stage-icon"><Icon name="screen" /></div>
          <p className="eyebrow">Couch</p>
          <span>{error ? "Video display unavailable" : "Ready when you are."}</span>
          <p>{error || (active ? title : "Open Home to choose something to watch or listen to.")}</p>
        </div>
      )}
    </div>
  );
}
