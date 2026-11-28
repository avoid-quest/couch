import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * How loud an audio input is right now, as a bar that fills with its level (−60 dB to 0 dB), so the right input can be
 * seen alive before and while it goes out. It reads the stream's first audio track; with none it isn't shown. The bar
 * is drawn outside React, about fifteen times a second; reduced motion still moves it, since it measures, not decorates.
 */
export function InputLevel({
  stream,
  muted = false,
  className,
}: {
  stream: MediaStream | null | undefined;
  muted?: boolean;
  className?: string;
}) {
  const fill = useRef<HTMLSpanElement>(null);
  const track = stream?.getAudioTracks()[0];
  useEffect(() => {
    const bar = fill.current;
    if (!track || !bar || muted) return;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const source = context.createMediaStreamSource(new MediaStream([track]));
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      const db = 20 * Math.log10(peak || 1e-6);
      bar.style.transform = `scaleX(${Math.min(1, Math.max(0, (db + 60) / 60)).toFixed(3)})`;
    }, 66);
    return () => {
      clearInterval(timer);
      bar.style.removeProperty("transform");
      source.disconnect();
      void context.close().catch(() => {});
    };
  }, [track, muted]);
  if (!track) return null;
  return (
    <span
      aria-hidden="true"
      data-input-level
      className={cn("relative block h-1 overflow-hidden rounded-full bg-muted", className)}
    >
      <span
        ref={fill}
        className="absolute inset-0 origin-left scale-x-0 bg-foreground/70 motion-safe:transition-transform motion-safe:duration-75"
      />
    </span>
  );
}
