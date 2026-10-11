import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { VideoQuality } from "../../shared/providers";
import { videoQualityOptions } from "@/video-quality";

export function QualitySelect({ id, value, disabled, onChange, label = "Video quality", description }: { id: string; value: VideoQuality; disabled?: boolean; onChange: (quality: VideoQuality) => void; label?: string; description?: string }) {
  return <div className="grid min-w-0 w-full gap-2">
    <Label htmlFor={id}>{label}</Label>
    <Select value={value} disabled={disabled} onValueChange={quality => onChange(quality as VideoQuality)}>
      <SelectTrigger id={id} aria-describedby={description ? `${id}-description` : undefined} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{videoQualityOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
    {description && <p id={`${id}-description`} className="text-sm text-muted-foreground">{description}</p>}
  </div>;
}
