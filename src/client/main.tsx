import { StrictMode, useEffect, useLayoutEffect, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { NativeModeGate } from "@/sections/shell/PlaybackDevice";
import { SessionGate, useSessionGate } from "./session/session-context";
import { couchApp } from "./session/native-context";
import { registerAppShellWorker } from "./register-sw";
import { router } from "./router";
import "./index.css";

document.documentElement.classList.add("dark");
registerAppShellWorker();

function SessionRouter() {
  const { queryClient, identity, localHost, connected } = useSessionGate();
  // beforeLoad and the rendered shell share the live identity. Re-evaluate
  // existing matches after role/revocation/reconnect transitions as well.
  useLayoutEffect(() => { void router.invalidate(); }, [queryClient, identity?.authority, identity?.device?.id, identity?.claimAvailable, connected]);
  return <RouterProvider router={router} context={{ queryClient, identity, localHost, connected }} />;
}

// Tells the app window that this page's shell mounted: React committed the whole
// tree, which it doesn't when rendering it fails (app/renderer-status.ts).
function ShellReady({ children }: PropsWithChildren) {
  useEffect(() => { void couchApp?.shellReady?.().catch(() => {}); }, []);
  return children;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ShellReady>
      <NativeModeGate>
        <SessionGate upNext={targetDeviceId => void router.navigate({ to: "/now", search: { queue: true, targetDeviceId } })}><SessionRouter /></SessionGate>
      </NativeModeGate>
    </ShellReady>
  </StrictMode>,
);
