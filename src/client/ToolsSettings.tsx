import { useEffect, useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ManagedToolHealth, ToolHealth, ToolObservation, AptPackageStatus } from "../shared/tool-health";

type Props = { credentials: { origin: string; token: string }; connected: boolean; children?: ReactNode; revision?: string };
const statuses: Record<ToolObservation["status"], string> = { ready: "Ready", missing: "Missing", corrupt: "Does not match release", error: "Check failed", unknown: "Unknown" };
const sources: Record<ManagedToolHealth["effective"]["source"], string> = { package: "Shipped package", environment: "Environment override", "search-path": "Search-path fallback", unavailable: "Not found" };

export function ToolsSettings({ credentials, connected, children, revision }: Props) {
  const [packages, setPackages] = useState<AptPackageStatus | null>(null);
  const [report, setReport] = useState<ToolHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { setReport(null); setPackages(null); setError(null); }, [credentials.origin, credentials.token, connected, revision]);
  useEffect(() => {
    if (!connected) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(null);
    void fetch(`${credentials.origin}/api/tools/packages`, { headers: { Authorization: `Bearer ${credentials.token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then(async response => response.ok ? response.json() as Promise<AptPackageStatus> : null)
      .then(result => { if (!controller.signal.aborted) setPackages(result); }).catch(() => { if (!controller.signal.aborted) setPackages(null); });
    void fetch(`${credentials.origin}/api/tools`, { headers: { Authorization: `Bearer ${credentials.token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<ToolHealth>; })
      .then(result => { if (!controller.signal.aborted) setReport(result); })
      .catch(() => { if (!controller.signal.aborted) setError("Could not check media tools. Check the TV connection and try again."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [credentials.origin, credentials.token, connected, refresh, revision]);

  return <section aria-labelledby="tools-title" className="min-w-0 space-y-3 border-t pt-4">
    <h3 id="tools-title" className="font-medium">Tools</h3>
    <p className="text-muted-foreground">yt-dlp and Deno are shipped and tested with this Couch release. Local checks keep playback running. A website or network failure does not mean a tool is damaged.</p>
    {!connected && <p role="status">Connect to the TV to check its media tools.</p>}
    {connected && report && <>
      <p className="text-muted-foreground">Last completed check: {new Date(report.checkedAt).toLocaleString()}. Checks within {report.cacheSeconds} seconds share the latest result.</p>
      {report.tools.map(tool => <div key={tool.name} className="min-w-0 space-y-2 rounded-lg border p-3">
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
      <div className="space-y-2 rounded-lg border p-3">
        <h4 className="font-medium">ffprobe</h4>
        <p>Runtime dependency: {report.ffprobe.status === "ready" ? `Available, version ${report.ffprobe.version}` : statuses[report.ffprobe.status]}</p>
        {report.ffprobe.error && <p className="text-muted-foreground">{report.ffprobe.error}</p>}
        <p className="text-muted-foreground">ffprobe and application media libraries are bundled with Couch. The machine administrator maintains Debian host packages separately from Couch releases.</p>
      </div>
    </>}
    {children}
    {connected && <div className="space-y-2 rounded-lg border p-3">
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
    <Button variant="outline" className="min-h-11" disabled={!connected || loading} onClick={() => setRefresh(value => value + 1)}>Check tools</Button>
  </section>;
}
