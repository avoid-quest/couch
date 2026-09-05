import type { ReactNode } from "react";

type IconName = "play" | "pause" | "next" | "stop" | "volume" | "plus" | "close" | "up" | "down" | "screen" | "folder" | "fullscreen";
export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    play: <path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" />,
    pause: <><path d="M8 5v14M16 5v14" strokeWidth="4" /></>,
    next: <><path d="m5 5 11 7-11 7Z" fill="currentColor" stroke="none" /><path d="M19 5v14" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none" />,
    volume: <><path d="M4 9v6h4l5 4V5L8 9Z" /><path d="M17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    up: <path d="m6 14 6-6 6 6" />,
    down: <path d="m6 10 6 6 6-6" />,
    screen: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    folder: <path d="M3 7V5h7l2 3h9v11H3V7Z" />,
    fullscreen: <path d="M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6" />,
  };
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

