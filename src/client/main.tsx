import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NativeModeGate } from "./PlaybackDevice";
import { App } from "./App";
import { CouchRouter } from "./routes";
import "./index.css";
import "./theme.css";
import "./styles.css";
import "./tv-mode.css";
import "./couch-shell.css";
import "./appearance.css";

document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NativeModeGate><CouchRouter><App /></CouchRouter></NativeModeGate>
  </StrictMode>,
);
