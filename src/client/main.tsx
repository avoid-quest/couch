import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NativeModeGate } from "@/sections/shell/PlaybackDevice";
import { registerAppShellWorker } from "./register-sw";
import { router } from "./router";

document.documentElement.classList.add("dark");
registerAppShellWorker();

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NativeModeGate>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </NativeModeGate>
  </StrictMode>,
);
