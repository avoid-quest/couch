import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { CouchRouter } from "./routes";
import "./theme.css";
import "./styles.css";
import "./tv-mode.css";
import "./couch-shell.css";
import "./appearance.css";

document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CouchRouter><App /></CouchRouter>
  </StrictMode>,
);
