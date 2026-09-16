import { useState } from "react";
import { Button } from "@/components/ui/button";
import { defaultTvAppearance, type InterfaceSize, type TvAppearance } from "../../../../shared/appearance";
import type { Credentials } from "../../../session/session";
import { saveRemoteInterfaceSize, useRemoteInterfaceSize } from "../../../interface-size";
import { InterfaceSizeChoices } from "./InterfaceSizeChoices";
import { TvInterfaceSize } from "./TvInterfaceSize";

type Props = { native: boolean; credentials: Credentials | null; connected: boolean; administrator: boolean; appearance?: TvAppearance; scope?: "all" | "device" | "tv" };

export function AppearanceSettings({ native, credentials, connected, administrator, appearance = defaultTvAppearance, scope = "all" }: Props) {
  const size = useRemoteInterfaceSize();
  const [notice, setNotice] = useState<string | null>(null);
  const change = (value: InterfaceSize) => setNotice(saveRemoteInterfaceSize(value) ? null : "Changed for this visit. Allow browser storage to keep this size after reloading.");
  return (
    <div className="space-y-5">
      {(native || scope !== "device") && <TvInterfaceSize appearance={appearance} credentials={credentials} connected={connected} administrator={administrator} native={native} />}
      {!native && scope !== "tv" && (
        <section className="space-y-3" aria-labelledby="remote-interface-size">
          <h3 id="remote-interface-size">This remote interface size</h3>
          <p className="text-muted-foreground">Text and controls in this browser. Other remotes keep their own size.</p>
          <InterfaceSizeChoices label="This remote interface size" value={size} onChange={change} />
          <Button variant="outline" className="min-h-11" onClick={() => change(1)}>Reset this remote to default</Button>
          {notice && <p role="status">{notice}</p>}
        </section>
      )}
      <p className="text-muted-foreground">Interface size does not change the video picture or subtitles.</p>
    </div>
  );
}
