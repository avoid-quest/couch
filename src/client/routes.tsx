import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { BrowserRouter, HashRouter, useLocation, useNavigate } from "react-router";
import { pathForSection, sectionForPath } from "../shared/page-paths";
import { settingsPageForPath, settingsPagePath, settingsPages, type SettingsPage } from "../shared/settings-pages";

export const searchSources = ["All", "YouTube", "RaiPlay", "Radio", "TV folders", "Jellyfin", "Twitch", "Bandcamp"];
export type SearchRouteState = { query: string; source: string };
export function readSearchState(search: string): SearchRouteState {
  const params = new URLSearchParams(search);
  return { query: (params.get("q") ?? "").slice(0, 4096), source: searchSources.find(source => source === params.get("source")) ?? "All" };
}
export function searchLocation(state: SearchRouteState) {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.source !== "All" && searchSources.includes(state.source)) params.set("source", state.source);
  return `/search${params.size ? `?${params}` : ""}`;
}

export function CouchRouter({ children, native = isTauri() }: PropsWithChildren<{ native?: boolean }>) {
  const Router = native ? HashRouter : BrowserRouter;
  return <Router>{children}</Router>;
}

// Routing only changes the visible page. App, its session and visited pages stay mounted.
export function usePageRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const section = sectionForPath(location.pathname) ?? "Home";
  const settingsSection = settingsPageForPath(location.pathname) ?? (section === "Settings" ? "playback" : null);
  const [visited, setVisited] = useState(() => new Set([section]));
  const rememberedSearch = useRef("");
  if (section === "Search") rememberedSearch.current = location.search;
  useEffect(() => {
    setVisited(previous => previous.has(section) ? previous : new Set([...previous, section]));
    document.title = settingsSection ? `${settingsPages[settingsSection].label} · Settings · Couch` : section === "Home" ? "Couch" : `${section === "Queue" ? "Up next" : section} · Couch`;
    if (!sectionForPath(location.pathname)) void navigate("/", { replace: true });
    else if (location.pathname.replace(/\/$/, "") === "/settings/remotes") void navigate("/settings/connection", { replace: true });
    else if (location.pathname.replace(/\/$/, "") === "/settings") void navigate("/settings/playback", { replace: true });
  }, [section, settingsSection, location.pathname, navigate]);
  const sectionUrl = (name: string) => pathForSection(name) + (name === "Search" ? rememberedSearch.current : "");
  return {
    section, visited, sectionUrl, settingsSection,
    changeSettingsSection: (page: SettingsPage | null) => { const to = settingsPagePath(page); if (to !== location.pathname) void navigate(to); },
    changePage: (name: string) => { const to = sectionUrl(name); if (to !== location.pathname + location.search) void navigate(to); },
    back: () => { if (typeof window.history.state?.idx === "number" && window.history.state.idx > 0) void navigate(-1); else void navigate("/"); },
    searchState: readSearchState(rememberedSearch.current),
    changeSearch: (state: SearchRouteState) => { const to = searchLocation(state); if (to !== location.pathname + location.search) void navigate(to); },
  };
}
