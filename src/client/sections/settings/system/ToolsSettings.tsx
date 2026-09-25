import { useQuery } from "@tanstack/react-query";
import { SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ApiCredentials } from "@/api/client";
import { toolPackagesQuery, toolsQuery } from "@/api/settings";
import type { ManagedToolHealth, ToolObservation } from "../../../../shared/tool-health";
import { Fact, FactList } from "./DiagnosticFacts";

type Props = { credentials: ApiCredentials; connected: boolean };
const statuses: Record<ToolObservation["status"], string> = { ready: "Ready", missing: "Missing", corrupt: "Mismatch", error: "Check failed", unknown: "Unknown" };
const sources: Record<ManagedToolHealth["effective"]["source"], string> = { package: "Shipped", environment: "Env override", "search-path": "System PATH", unavailable: "Not found" };
const when = (at: string | number) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ToolsSettings({ credentials, connected }: Props) {
  const tools = useQuery({ ...toolsQuery(credentials), enabled: connected });
  const packagesQuery = useQuery({ ...toolPackagesQuery(credentials), enabled: connected });
  const report = tools.data ?? null;
  const packages = packagesQuery.data ?? null;
  const loading = tools.isFetching;
  const refresh = () => { void tools.refetch(); void packagesQuery.refetch(); };

  return <SettingsSection title="Tools" description="yt-dlp and Deno ship with Couch. Site errors don't mean a tool is broken.">
    {report && <FactList>
      {report.tools.map(tool => <Fact key={tool.name} name={tool.name}
        value={`${tool.installed.version ?? "Not verified"} · ${tool.installed.status === "ready" ? "Verified" : statuses[tool.installed.status]}`}
        note={[tool.effective.source !== "package" && `In use: ${sources[tool.effective.source]} ${tool.effective.version ?? ""} (${statuses[tool.effective.status]})`, tool.installed.error, tool.effective.source !== "package" && tool.effective.error].filter(Boolean).join(" · ") || undefined} />)}
      <Fact name="ffprobe" value={report.ffprobe.status === "ready" ? `${report.ffprobe.version} · Bundled` : statuses[report.ffprobe.status]} note={report.ffprobe.error ?? undefined} />
      {packages && <Fact name="System packages" value={typeof packages.available === "number" ? `${packages.available} updates (${packages.security} security)${packages.broken ? ` · Broken: ${packages.broken}` : ""}` : packages.error || "Unknown"}
        note={`Read-only. Couch doesn't install system updates.${packages.indexUpdatedAt ? ` Index refreshed ${when(packages.indexUpdatedAt)}.` : ""}`} />}
    </FactList>}
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" disabled={!connected || loading} onClick={refresh}>Check tools</Button>
      {loading ? <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Checking…</span>
        : report && <span className="text-sm text-muted-foreground">Checked {when(report.checkedAt)}</span>}
    </div>
    {tools.error && <Alert variant="destructive"><AlertDescription>Couldn't check tools.</AlertDescription></Alert>}
  </SettingsSection>;
}
