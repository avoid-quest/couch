// PROTOTYPE — throwaway. UI directions for Couch's TV + desktop player and
// search, switchable with ?variant= and ?screen=tv|desktop.
// Search hits real APIs; playback is simulated (see sections/prototype/proto-data).
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useState } from "react";
import { useShell } from "../sections/shell/AppShell";
import { ProtoProvider } from "../sections/prototype/proto-data";
import { PrototypeSwitcher } from "../sections/prototype/PrototypeSwitcher";
import { Couch, type Look } from "../sections/prototype/Couch";
import { clockLook } from "../sections/prototype/Looks";

// Round 2: one shared layout; Clock won over Colour and Focus.
const look = (value: Look) => ({ screen }: { screen: "tv" | "desktop" }) => <Couch look={value} screen={screen} />;
const variants = [
  { key: "A", name: "Clock", Component: look(clockLook) },
];

export const Route = createFileRoute("/prototype")({
  validateSearch: (search: Record<string, unknown>) => ({
    variant: typeof search.variant === "string" ? search.variant : "A",
    screen: search.screen === "tv" ? "tv" as const : "desktop" as const,
  }),
  component: Prototype,
});

const fonts = "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@100..900&display=swap";

function Prototype() {
  const { credentials } = useShell();
  const { variant, screen } = Route.useSearch();
  const navigate = useNavigate({ from: "/prototype" });
  const current = variants.find(v => v.key === variant) ?? variants[0]!;
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: fonts });
    document.head.append(link);
    return () => link.remove();
  }, []);
  useLayoutEffect(() => {
    // TV mode: a true 1920×1080 canvas at Couch's 24px TV base size, scaled to fit.
    // Desktop: the same layout scaled proportionally (1rem = 1/80 of the width).
    const fit = () => {
      setScale(Math.min(innerWidth / 1920, innerHeight / 1080));
      document.documentElement.style.fontSize = screen === "tv" ? "24px" : `${Math.max(12, Math.min(innerWidth / 80, innerHeight / 45))}px`;
    };
    fit(); addEventListener("resize", fit);
    return () => { removeEventListener("resize", fit); document.documentElement.style.fontSize = ""; };
  }, [screen]);
  return <ProtoProvider credentials={credentials}>
    <div className="fixed inset-0 grid place-items-center overflow-hidden bg-[#1a1a1a]">
      <div key={current.key} data-screen={screen} className="relative overflow-hidden [container-type:size]"
        style={screen === "tv" ? { width: 1920, height: 1080, zoom: scale } : { width: "100vw", height: "100dvh" }}>
        <current.Component screen={screen} />
      </div>
    </div>
    <PrototypeSwitcher variants={variants} current={current.key} screen={screen}
      onVariant={key => void navigate({ search: s => ({ ...s, variant: key }), replace: true })}
      onScreen={value => void navigate({ search: s => ({ ...s, screen: value }), replace: true })} />
  </ProtoProvider>;
}
