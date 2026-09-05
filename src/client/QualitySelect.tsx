import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { VideoQuality } from "../shared/providers";
import { videoQualityLabels } from "./video-quality";

export function QualitySelect({ id, value, disabled, onChange, label = "Video quality" }: { id: string; value: VideoQuality; disabled?: boolean; onChange: (quality: VideoQuality) => void; label?: string }) {
  return <div className="quality-select grid gap-2">
    <Label htmlFor={id}>{label}</Label>
    <Select value={value} disabled={disabled} onValueChange={quality => onChange(quality as VideoQuality)}>
      <SelectTrigger id={id} className="min-h-11 w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{(Object.entries(videoQualityLabels) as [VideoQuality, string][]).map(([quality, name]) => <SelectItem key={quality} value={quality} className="min-h-11">{name}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
}
