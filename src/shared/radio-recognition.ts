export type RecognizedSong = {
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  url?: string;
  provider: "shazam";
};

/** An observation of a radio stream, separate from its station and programme. */
export type RadioRecognitionResult = { track: RecognizedSong | null; sampledAt: number };
