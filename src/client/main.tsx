import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { NativeModeGate } from "./PlaybackDevice";
import { router } from "./router";
import "./index.css";
import "./theme.css";
import "./styles.css";
import "./tv-mode.css";
import "./couch-shell.css";
import "./appearance.css";

document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NativeModeGate><RouterProvider router={router} /></NativeModeGate>
  </StrictMode>,
);
