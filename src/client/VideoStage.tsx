import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Music2 } from "lucide-react";
import { Icon } from "./Icon";

const nativeHost = isTauri();
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
    };
  }, []);

  return (
    <div ref={element} className={`video-stage${nativeHost && active && !audioOnly ? " has-video" : ""}${active && audioOnly ? " audio-stage" : ""}`} aria-label="TV playback">
      {active && audioOnly && !error ? (
        <div className="audio-stage-caption">
          <div className={`audio-stage-artwork${artwork ? "" : " without-artwork"}`} aria-hidden="true">{artwork || <Music2 />}</div>
          <div className="audio-stage-copy"><p className="eyebrow">Listening now</p><h1>{title}</h1>{subtitle && <p className="audio-stage-track" role="status">{subtitle}</p>}<p className="audio-stage-hint">Use your remote to change the music.</p></div>
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
