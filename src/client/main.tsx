import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NativeModeGate } from "./PlaybackDevice";
import { router } from "./router";
import "./index.css";
import "./theme.css";
import "./styles.css";
import "./tv-mode.css";
import "./couch-shell.css";
import "./appearance.css";

document.documentElement.classList.add("dark");

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
