import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { NativeModeGate } from "@/sections/shell/PlaybackDevice";
import { registerAppShellWorker } from "./register-sw";
import { queryClient, router } from "./router";
import "./index.css";

document.documentElement.classList.add("dark");
registerAppShellWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NativeModeGate>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </NativeModeGate>
  </StrictMode>,
);
