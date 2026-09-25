import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ApiCredentials } from "@/api/client";
import { toolPackagesQuery, toolsQuery } from "@/api/settings";
import type { ManagedToolHealth, ToolObservation } from "../../../../shared/tool-health";

type Props = { credentials: ApiCredentials; connected: boolean; children?: ReactNode };
const statuses: Record<ToolObservation["status"], string> = { ready: "Ready", missing: "Missing", corrupt: "Does not match release", error: "Check failed", unknown: "Unknown" };
const sources: Record<ManagedToolHealth["effective"]["source"], string> = { package: "Shipped package", environment: "Environment override", "search-path": "Search-path fallback", unavailable: "Not found" };

export function ToolsSettings({ credentials, connected, children }: Props) {
  const tools = useQuery({ ...toolsQuery(credentials), enabled: connected });
  const packagesQuery = useQuery({ ...toolPackagesQuery(credentials), enabled: connected });
  const report = tools.data ?? null;
  const packages = packagesQuery.data ?? null;
  const error = tools.error ? "Could not check media tools. Check the TV connection and try again." : null;
  const loading = tools.isPending || tools.isFetching;
  const refresh = () => { void tools.refetch(); void packagesQuery.refetch(); };

  return <section aria-labelledby="tools-title" className="min-w-0 space-y-3 border-t pt-4">
    <h3 id="tools-title" className="font-medium">Tools</h3>
    <p className="text-muted-foreground">yt-dlp and Deno are shipped and tested with this Couch release. Local checks keep playback running. A website or network failure does not mean a tool is damaged.</p>
    {!connected && <p role="status">Connect to the TV to check its media tools.</p>}
    {connected && report && <>
      <p className="text-muted-foreground">Last completed check: {new Date(report.checkedAt).toLocaleString()}. Checks within {report.cacheSeconds} seconds share the latest result.</p>
      {report.tools.map(tool => <div key={tool.name} className="min-w-0 space-y-2 border-t border-border py-4">
        <h4 className="font-medium">{tool.name}</h4>
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
          <dt>Expected version</dt><dd className="break-all">{tool.expectedVersion ?? "Unknown for this build"}</dd>
          <dt>Installed version</dt><dd className="break-all">{tool.installed.version ?? "Not verified"}</dd>
          <dt>Package check</dt><dd>{tool.installed.status === "ready" ? "Verified for this release" : statuses[tool.installed.status]}</dd>
          <dt>Effective tool</dt><dd>{sources[tool.effective.source]}</dd>
          {tool.effective.source !== "package" && <><dt>Effective version</dt><dd className="break-all">{tool.effective.version ?? "Unknown"}</dd><dt>Effective check</dt><dd>{statuses[tool.effective.status]}</dd></>}
        </dl>
        {tool.installed.error && <p className="text-muted-foreground">{tool.installed.error}</p>}
        {tool.effective.source !== "package" && tool.effective.error && <p className="text-muted-foreground">{tool.effective.error}</p>}
      </div>)}
      <div className="space-y-2 border-t border-border py-4">
        <h4 className="font-medium">ffprobe</h4>
        <p>Runtime dependency: {report.ffprobe.status === "ready" ? `Available, version ${report.ffprobe.version}` : statuses[report.ffprobe.status]}</p>
        {report.ffprobe.error && <p className="text-muted-foreground">{report.ffprobe.error}</p>}
        <p className="text-muted-foreground">ffprobe and application media libraries are bundled with Couch. The machine administrator maintains Debian host packages separately from Couch releases.</p>
      </div>
    </>}
    {children}
    {connected && <div className="space-y-2 border-t border-border py-4">
      <h4 className="font-medium">System packages and security</h4>
      {packages && typeof packages.available === "number" ? <>
        <p>{packages.available} actionable distribution upgrades in APT's current plan; {packages.security} from security repositories.</p>
        <p>Packages with broken dependencies: {packages.broken}.</p>
        <p className="text-muted-foreground">Last automated index refresh: {packages.indexUpdatedAt ? new Date(packages.indexUpdatedAt).toLocaleString() : "Unknown"}.</p>
      </> : <p>{packages?.error || "System package status is unavailable."}</p>}
      <p className="text-muted-foreground">This reads local package indexes for Debian and Ubuntu repositories. Third-party packages are excluded. Check tools does not refresh repositories, upgrade packages or upgrade the OS release.</p>
    </div>}
    {loading && <p role="status">Checking local media tools…</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <Button variant="outline" className="min-h-11" disabled={!connected || loading} onClick={refresh}>Check tools</Button>
  </section>;
}
