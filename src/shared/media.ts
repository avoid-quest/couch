export const audioExtensions = new Set("mp3 flac m4a aac ogg opus wav aiff aif wma alac ape ac3 dts dsf dff".split(" "));

// A catalog reference is either playable by itself or expands into ordered
// playable atoms when it is queued.
export type MediaShape = "atom" | "playlist";
