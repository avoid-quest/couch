import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { VideoQuality } from "../../shared/providers";
import { videoQualityLabels } from "@/video-quality";

export function QualitySelect({ id, value, disabled, onChange, label = "Next video quality", description }: { id: string; value: VideoQuality; disabled?: boolean; onChange: (quality: VideoQuality) => void; label?: string; description?: string }) {
  return <div className="grid min-w-0 w-full gap-2">
    <Label htmlFor={id}>{label}</Label>
    <Select value={value} disabled={disabled} onValueChange={quality => onChange(quality as VideoQuality)}>
      <SelectTrigger id={id} aria-describedby={description ? `${id}-description` : undefined} className="min-h-11 w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{(Object.entries(videoQualityLabels) as [VideoQuality, string][]).map(([quality, name]) => <SelectItem key={quality} value={quality} className="min-h-11">{name}</SelectItem>)}</SelectContent>
    </Select>
    {description && <p id={`${id}-description`} className="text-sm text-muted-foreground">{description}</p>}
  </div>;
}

export function QualityOptions({ id, value, disabled, onChange, label = "Video quality" }: { id: string; value: VideoQuality; disabled?: boolean; onChange: (quality: VideoQuality) => void; label?: string }) {
  return <Popover>
    <PopoverTrigger asChild><Button variant="ghost" className="min-h-11 min-w-11" disabled={disabled} aria-label={label} title={label}><Settings2 aria-hidden="true" /></Button></PopoverTrigger>
    <PopoverContent className="w-64 max-w-[calc(100vw-2rem)] p-4" aria-label={label}>
      <QualitySelect id={id} label="Video quality" value={value} disabled={disabled} onChange={onChange} description="For the next video you play or add." />
    </PopoverContent>
  </Popover>;
}
