import { useState } from "react";
import { Button } from "@/components/ui/button";
import { defaultTvAppearance, type InterfaceSize, type TvAppearance } from "../../../../shared/appearance";
import type { Credentials } from "../../../session/session";
import { saveRemoteInterfaceSize, useRemoteInterfaceSize } from "../../../interface-size";
import { InterfaceSizeChoices } from "./InterfaceSizeChoices";
import { TvInterfaceSize } from "./TvInterfaceSize";

type Props = { tvPresentation: boolean; credentials: Credentials | null; connected: boolean; administrator: boolean; appearance?: TvAppearance; scope?: "all" | "device" | "tv"; hostName?: string };

export function AppearanceSettings({ tvPresentation, credentials, connected, administrator, appearance = defaultTvAppearance, scope = "all", hostName = "Couch" }: Props) {
  const size = useRemoteInterfaceSize();
  const [notice, setNotice] = useState<string | null>(null);
  const change = async (value: InterfaceSize) => setNotice(await saveRemoteInterfaceSize(value) ? null : "Changed for this visit. This client could not save the size.");
  return (
    <div className="space-y-5">
      {(tvPresentation || scope === "tv" || scope === "all") && <TvInterfaceSize appearance={appearance} credentials={credentials} connected={connected} administrator={administrator} native={tvPresentation} hostName={hostName} />}
      {!tvPresentation && scope !== "tv" && (
        <section className="space-y-3" aria-labelledby="remote-interface-size">
          <div className="settings-choice-row grid grid-cols-[16rem_minmax(0,1fr)] items-center gap-4 border-t border-border py-3 max-[900px]:grid-cols-1"><h3 id="remote-interface-size">This client interface size</h3><InterfaceSizeChoices label="This client interface size" value={size} onChange={value => void change(value)} /></div>
          <p className="text-muted-foreground">Text and controls on this client. Other clients keep their own size.</p>
          <Button variant="outline" className="min-h-11" onClick={() => void change(1)}>Reset this client to default</Button>
          {notice && <p role="status">{notice}</p>}
        </section>
      )}
      <p className="text-muted-foreground">Interface size does not change the video picture or subtitles.</p>
    </div>
  );
}
