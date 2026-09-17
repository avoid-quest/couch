import type { BrowseRequest, ProviderPage } from "../../shared/providers";
import { streamingCommunityOrigin } from "../../shared/streamingcommunity";
import { streamingCommunityBrowse, streamingCommunityList } from "../streamingcommunity";

export function browseStreamingCommunity(request: BrowseRequest, signal?: AbortSignal, origin = streamingCommunityOrigin): Promise<ProviderPage> {
  return streamingCommunityBrowse(request, origin, signal);
}

export const loadStreamingCommunityList = streamingCommunityList;
