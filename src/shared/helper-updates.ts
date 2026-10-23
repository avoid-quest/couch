export type HelperUpdate = {
  name: "yt-dlp" | "qjs" | "ffmpeg" | "mpv";
  version: string | null;
  origin: "system" | "managed" | null;
  status: "checking" | "updated" | "current" | "compatible" | "held" | "system" | "error";
  error: string | null;
};

export type HelperUpdates = {
  status: "idle" | "checking" | "done";
  checkedAt: number | null;
  items: HelperUpdate[];
};
