import { defaultStringifySearch } from "@tanstack/react-router";

export const radioBrowseSources = ["avoid radio", "Radio playlists", "Radio directory"] as const;
export type RadioBrowseSource = typeof radioBrowseSources[number];
// Radio shares Live with Live TV, so its moves keep the rest of Live's search (`keep`).
export const radioBrowseLocation = (source: RadioBrowseSource = "avoid radio", page = 1, filter = "", keep: Record<string, unknown> = {}) =>
  `/live${defaultStringifySearch({ ...keep, radioSource: source !== "avoid radio" ? source : undefined, page: page > 1 ? page : undefined, filter: filter || undefined })}`;
