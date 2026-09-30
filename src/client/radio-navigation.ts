import { defaultStringifySearch } from "@tanstack/react-router";

export const radioBrowseSources = ["avoid radio", "Radio playlists", "Radio directory"] as const;
export type RadioBrowseSource = typeof radioBrowseSources[number];
export const radioBrowseLocation = (source: RadioBrowseSource = "avoid radio", page = 1, filter = "") => `/find${defaultStringifySearch({ browse: "radio", ...(source !== "avoid radio" ? { radioSource: source } : {}), ...(page > 1 ? { page } : {}), ...(filter ? { filter } : {}) })}`;
