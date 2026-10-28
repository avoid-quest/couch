// Provider intervals on the programme timeline. Asset addresses stay in Core.
export type PreviewFrame = { image: number; startTime: number; endTime: number; width?: number; height?: number; coords?: { x: number; y: number } };
export type PlaybackPreview = { duration: number; images: number } & (
  | { kind: "grid"; width: number; height: number; columns: number; rows: number; interval: number; frames: number }
  | { kind: "cues"; cues: PreviewFrame[] }
);

// One lookup for compact grids and provider-authored cues, including honest gaps.
export function previewAt(preview: PlaybackPreview, time: number): PreviewFrame | null {
  if (!Number.isFinite(time)) return null;
  const position = Math.max(0, Math.min(time, preview.duration - .001));
  if (preview.kind === "grid") {
    const frame = Math.min(preview.frames - 1, Math.floor(position / preview.interval));
    const cells = preview.columns * preview.rows, cell = frame % cells;
    return { image: Math.floor(frame / cells), startTime: frame * preview.interval, endTime: Math.min(preview.duration, (frame + 1) * preview.interval),
      width: preview.width, height: preview.height, coords: { x: cell % preview.columns * preview.width, y: Math.floor(cell / preview.columns) * preview.height } };
  }
  let low = 0, high = preview.cues.length;
  while (low < high) { const middle = (low + high) >>> 1; if (preview.cues[middle]!.startTime <= position) low = middle + 1; else high = middle; }
  const cue = preview.cues[low - 1];
  return cue && position < cue.endTime ? cue : null;
}
