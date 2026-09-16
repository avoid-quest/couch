export const streamingCommunityOrigin = "https://streamingcommunityz.academy";

export function validStreamingCommunityOrigin(value: unknown): value is string {
  return typeof value === "string" && value.length <= 253 && /^https:\/\/(?:www\.)?[a-z0-9]*stream[a-z0-9]*unity[a-z0-9]*\.[a-z]{2,63}$/.test(value);
}
