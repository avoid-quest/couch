import { defaultStringifySearch } from "@tanstack/react-router";

export const radioBrowseSources = ["avoid radio", "Radio playlists", "Radio directory"] as const;
export type RadioBrowseSource = typeof radioBrowseSources[number];
export const radioBrowseLocation = (source: RadioBrowseSource = "avoid radio", page = 1, filter = "") =>
  `/radio${defaultStringifySearch({ radioSource: source !== "avoid radio" ? source : undefined, page: page > 1 ? page : undefined, filter: filter || undefined })}`;
