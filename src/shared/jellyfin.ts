export type JellyfinStatus = { connected: boolean; serverName: string | null; username: string | null };
export type JellyfinConnection = JellyfinStatus & { url: string | null };

export type JellyfinItem = {
  id: string;
  title: string;
  kind: "Movie" | "Episode" | "Audio";
  detail: string | null;
  duration: number | null;
  played: boolean;
  resumePosition: number;
};

export type JellyfinItems = { items: JellyfinItem[]; total: number; startIndex: number };
