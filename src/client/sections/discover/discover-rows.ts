import { readSectionRows, useSectionRows, type SectionRow } from "../section-rows";

// Source IDs stay independent of their current availability, contents and display names.
export const discoverRowLabels = {
  shared: "Shared sources", radio: "Radio", "live-tv": "Live TV", twitch: "Twitch",
  streamingcommunity: "StreamingCommunity", raiplay: "RaiPlay", movies123: "123MoviesFree",
  animesaturn: "AnimeSaturn", animeunity: "AnimeUnity", sources: "Sources",
} as const;
export type DiscoverRowId = keyof typeof discoverRowLabels;
export const defaultDiscoverRows: SectionRow<DiscoverRowId>[] = (Object.keys(discoverRowLabels) as DiscoverRowId[]).map(id => ({ id, shown: true }));
export const readDiscoverRows = (storage?: Pick<Storage, "getItem">) => readSectionRows("couch.discover-rows", defaultDiscoverRows, storage);
export const useDiscoverRows = () => useSectionRows("couch.discover-rows", defaultDiscoverRows);
