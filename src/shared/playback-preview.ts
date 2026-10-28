// Provider interval thumbnails, in seconds on the programme timeline. Image addresses stay in Core.
export type PlaybackPreview = {
  width: number;
  height: number;
  columns: number;
  rows: number;
  interval: number;
  duration: number;
  sheets: number;
};

export function previewSheet(preview: PlaybackPreview, time: number): number {
  const frame = Math.min(Math.ceil(preview.duration / preview.interval) - 1, Math.floor(Math.max(0, time) / preview.interval));
  return Math.min(preview.sheets - 1, Math.floor(frame / (preview.columns * preview.rows)));
}
