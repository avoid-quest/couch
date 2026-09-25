import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiFetch, type ApiCredentials } from "@/api/client";
import { diagnosticsQuery } from "@/api/settings";
import { isNativeHost } from "@/session/native-context";
import { DiagnosticFacts } from "./DiagnosticFacts";
import { ToolsSettings } from "./ToolsSettings";

const diagnosticTime = (at: string) => at.replace("T", " ").replace("Z", " UTC");

function useExportDiagnostics(credentials: ApiCredentials, native: boolean) {
  return useMutation({
    mutationFn: async () => {
      const response = await apiFetch(credentials, "/api/diagnostics/export", {}, 10_000);
      if (native) {
        const bytes = await response.arrayBuffer().catch(() => { throw new Error("Diagnostic transfer stopped before the report was complete. No file was saved."); });
        return await invoke<boolean>("save_diagnostics_export", new Uint8Array(bytes)) ? "Diagnostics report saved." : "Save canceled. No file was saved.";
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = "couch-diagnostics.json";
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      return "Diagnostic download started.";
    },
  });
}

export function AdvancedSettings({ credentials, connected }: { credentials: ApiCredentials; connected: boolean }) {
  const diagnostics = useQuery({ ...diagnosticsQuery(credentials), enabled: connected });
  const report = diagnostics.data ?? null;
  const native = isNativeHost();
  const exportDiagnostics = useExportDiagnostics(credentials, native);
  const exporting = exportDiagnostics.isPending;
  const loading = diagnostics.isPending || diagnostics.isFetching;
  const reason: unknown = exportDiagnostics.error;
  const exportError = !reason ? null : reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Could not save diagnostics. Check the connection and administrator access, then try again.";
  const error = diagnostics.error ? "Could not load diagnostics. Check the connection and administrator access, then refresh." : exportError;
  const notice = exportDiagnostics.data ?? null;
  const refresh = () => void diagnostics.refetch();

  return <div className="min-w-0 space-y-4" data-advanced-settings>
    <p className="text-muted-foreground">System details and diagnostics.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" className="min-h-11" disabled={!connected || loading || exporting} onClick={refresh}><RefreshCw aria-hidden="true" />Refresh</Button>
      <Button variant="outline" className="min-h-11" disabled={!connected || loading || exporting || !report} onClick={() => exportDiagnostics.mutate()}><Download aria-hidden="true" />{exporting ? "Exporting…" : native ? "Save diagnostics" : "Export diagnostics"}</Button>
    </div>
    <p className="text-xs text-muted-foreground">{native ? "Choose where to save the sanitized JSON report." : "Downloads a sanitized JSON report."} URLs and credentials are removed.</p>
    {!connected && <p role="status">Connect to the TV to load diagnostics.</p>}
    {loading && <p role="status">Loading diagnostics…</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <p role="status">{notice}</p>}
    {report && <>
      <p className="text-xs text-muted-foreground">Collected {diagnosticTime(report.collectedAt)}. Helper checks are cached for up to {report.limits.helperSeconds / 60} minutes.</p>
      <section className="space-y-2 border-t border-border py-4"><h3 className="font-medium">Build and system</h3><DiagnosticFacts facts={[
        { name: "Couch version", value: report.build.version, source: report.build.packaged ? "Packaged coordinator" : "Development coordinator" },
        { name: "Commit", value: report.build.revision, source: "Coordinator build" },
        { name: "Build target", value: report.build.target, source: "Coordinator build" },
        ...report.system,
      ]} /></section>
      <section className="space-y-2 border-t border-border py-4"><h3 className="font-medium">Native player, display and audio</h3>{report.native ? <DiagnosticFacts facts={[
        { name: "Native version", value: report.native.build.version, source: "Native host build" },
        { name: "Native commit", value: report.native.build.revision, source: "Native host build" },
        ...report.native.facts,
      ]} /> : <p className="text-muted-foreground">{report.nativeError ?? "Native details are unavailable."}</p>}</section>
      <section className="space-y-2 border-t border-border py-4"><h3 className="font-medium">Media helpers</h3><DiagnosticFacts facts={report.helpers.map(helper => ({ name: helper.name, value: helper.version ?? helper.status, source: `${helper.source}. ${helper.error ?? helper.status}` }))} /></section>
      <section className="space-y-2 border-t border-border py-4"><h3 className="font-medium">Effective configuration</h3><DiagnosticFacts facts={report.configuration} /></section>
      <section className="space-y-2 border-t border-border py-4"><h3 className="font-medium">Sources</h3>{report.sources.length ? <DiagnosticFacts facts={report.sources.map(source => ({ name: source.name, value: source.status, source: source.error ?? "No error reported" }))} /> : <p className="text-muted-foreground">No source status is available.</p>}</section>
      <section className="space-y-2 border-t border-border py-4">
        <h3 className="font-medium">Recent errors</h3>
        <p className="text-xs text-muted-foreground">Up to {report.limits.retentionDays} days, {report.limits.recentEntries} entries or {report.limits.historyBytes / 1024} KiB. Dates and times are UTC.</p>
        <p className="text-xs text-muted-foreground">Current session started {diagnosticTime(report.sessionStartedAt)}.</p>
        {report.historyError && <p role="status">{report.historyError}</p>}
        {report.recent.length ? <ol className="max-h-72 divide-y divide-border overflow-y-auto">{report.recent.map((entry, index) => <li key={index} className="min-w-0 space-y-1 break-words py-3">
          <p className="text-xs text-muted-foreground">{diagnosticTime(entry.at)} · {entry.source} · {entry.sessionId === report.sessionId ? "Current session" : "Earlier session"}</p>
          <p>{entry.message}</p>
          <p className="text-xs text-muted-foreground">Build {entry.build.version ?? "unknown"} · Commit {entry.build.revision ?? "unknown"}</p>
          {entry.count > 1 && <p className="text-xs text-muted-foreground">{entry.count} occurrences. Last: {diagnosticTime(entry.lastAt)}</p>}
        </li>)}</ol> : <p className="text-muted-foreground">No recent errors recorded.</p>}
      </section>
    </>}
    <ToolsSettings credentials={credentials} connected={connected} />
  </div>;
}
