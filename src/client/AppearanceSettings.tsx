import { useState } from "react";
import { Button } from "@/components/ui/button";
import { interfaceSizes, type InterfaceSize } from "../shared/appearance";
import { saveRemoteInterfaceSize, useRemoteInterfaceSize } from "./interface-size";

export function InterfaceSizeChoices({ label, value, disabled, onChange }: {
  label: string; value: InterfaceSize; disabled?: boolean; onChange: (value: InterfaceSize) => void;
}) {
  return <div role="group" aria-label={label} className="interface-size-choices">
    {interfaceSizes.map(size => <Button key={size.value} variant={value === size.value ? "secondary" : "outline"} aria-pressed={value === size.value} disabled={disabled} onClick={() => onChange(size.value)}>{size.label}</Button>)}
  </div>;
}

export function AppearanceSettings({ native }: { native: boolean }) {
  const size = useRemoteInterfaceSize();
  const [notice, setNotice] = useState<string | null>(null);
  const change = (value: InterfaceSize) => setNotice(saveRemoteInterfaceSize(value) ? null : "Changed for this visit. Allow browser storage to keep this size after reloading.");
  return <div className="space-y-5">
    {!native && <section className="space-y-3" aria-labelledby="remote-interface-size">
      <h3 id="remote-interface-size">This remote interface size</h3>
      <p className="text-muted-foreground">Text and controls in this browser. Other remotes keep their own size.</p>
      <InterfaceSizeChoices label="This remote interface size" value={size} onChange={change} />
      <Button variant="outline" className="min-h-11" onClick={() => change(1)}>Reset this remote to default</Button>
      {notice && <p role="status">{notice}</p>}
    </section>}
    <p className="text-muted-foreground">Interface size does not change the video picture or subtitles.</p>
  </div>;
}
