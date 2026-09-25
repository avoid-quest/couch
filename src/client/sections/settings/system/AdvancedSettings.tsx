import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiFetch, type ApiCredentials } from "@/api/client";
import { isNativeHost } from "@/session/native-context";
import type { Diagnostics } from "../../../../shared/diagnostics";
import { DiagnosticFacts } from "./DiagnosticFacts";
import { ToolsSettings } from "./ToolsSettings";

const diagnosticTime = (at: string) => at.replace("T", " ").replace("Z", " UTC");

function useExportDiagnostics({ credentials, connected, enabled, native }: { credentials: ApiCredentials; connected: boolean; enabled: boolean; native: boolean }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { origin, token } = credentials;

  useEffect(() => {
    if (!exporting || !connected || !enabled) return;
    const controller = new AbortController();
    setError(null); setNotice(null);
    void apiFetch({ origin, token }, "/api/diagnostics/export", { signal: controller.signal }, 10_000)
      .then(async response => {
        if (native) {
          const bytes = await response.arrayBuffer().catch(() => { throw new Error("Diagnostic transfer stopped before the report was complete. No file was saved."); });
          if (controller.signal.aborted) return;
          const saved = await invoke<boolean>("save_diagnostics_export", new Uint8Array(bytes));
          if (!controller.signal.aborted) setNotice(saved ? "Diagnostics report saved." : "Save canceled. No file was saved.");
          return;
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url; link.download = "couch-diagnostics.json";
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
        setNotice("Diagnostic download started.");
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Could not save diagnostics. Check the connection and administrator access, then try again."); })
      .finally(() => { if (!controller.signal.aborted) setExporting(false); });
    return () => controller.abort();
  }, [enabled, exporting, connected, origin, token, native]);

  return { exporting, setExporting, error, notice };
}

export function AdvancedSettings({ credentials, connected }: { credentials: ApiCredentials; connected: boolean }) {
  const queryClient = useQueryClient();
  const queryKey = ["diagnostics", credentials.origin, credentials.token];
  const diagnostics = useQuery({
    queryKey,
    enabled: connected,
    queryFn: () => apiFetch(credentials, "/api/diagnostics").then(response => response.json() as Promise<Diagnostics>),
    retry: false,
  });
  const report = diagnostics.data ?? null;
  const native = isNativeHost();
  const exportState = useExportDiagnostics({ credentials, connected, enabled: !!report, native });
  const loading = diagnostics.isPending || diagnostics.isFetching;
  const error = diagnostics.error ? "Could not load diagnostics. Check the connection and administrator access, then refresh." : exportState.error;
  const notice = exportState.notice;
  const refresh = () => void queryClient.invalidateQueries({ queryKey });


  return <div className="min-w-0 space-y-4" data-advanced-settings>
    <p className="text-muted-foreground">System details and diagnostics.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" className="min-h-11" disabled={!connected || loading || exportState.exporting} onClick={refresh}><RefreshCw aria-hidden="true" />Refresh</Button>
      <Button variant="outline" className="min-h-11" disabled={!connected || loading || exportState.exporting || !report} onClick={() => exportState.setExporting(true)}><Download aria-hidden="true" />{exportState.exporting ? "Exporting…" : native ? "Save diagnostics" : "Export diagnostics"}</Button>
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
