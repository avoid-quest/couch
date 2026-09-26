import { useMutation, useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
        const bytes = await response.arrayBuffer().catch(() => { throw new Error("Export interrupted. Nothing saved."); });
        return await invoke<boolean>("save_diagnostics_export", new Uint8Array(bytes)) ? "Exported." : "Canceled.";
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = "couch-diagnostics.json";
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      return "Downloaded.";
    },
    onSuccess: notice => toast(notice),
  });
}

export function AdvancedSettings({ credentials, connected }: { credentials: ApiCredentials; connected: boolean }) {
  const diagnostics = useQuery({ ...diagnosticsQuery(credentials), enabled: connected });
  const report = diagnostics.data ?? null;
  const native = isNativeHost();
  const exportDiagnostics = useExportDiagnostics(credentials, native);
  const exporting = exportDiagnostics.isPending;
  const loading = diagnostics.isFetching;
  const reason: unknown = exportDiagnostics.error;
  const exportError = !reason ? null : reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Couldn't export diagnostics.";
  const error = diagnostics.error ? "Couldn't load diagnostics." : exportError;

  return <div className="flex min-w-0 flex-col gap-8" data-advanced-settings>
    <SettingsSection>
      <SettingsRow label="Diagnostics" description="JSON report without URLs or credentials.">
        <Button variant="outline" disabled={!connected || loading || exporting || !report} onClick={() => exportDiagnostics.mutate()}>{exporting ? "Exporting…" : "Export"}</Button>
        <Button variant="ghost" disabled={!connected || loading || exporting} onClick={() => void diagnostics.refetch()}>Collect again</Button>
      </SettingsRow>
      {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Collecting…</p>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {report && <p className="text-xs text-muted-foreground">Collected {diagnosticTime(report.collectedAt)}. Helper checks are cached for {report.limits.helperSeconds / 60} minutes.</p>}
    </SettingsSection>
    <ToolsSettings credentials={credentials} connected={connected} />
    {report && <>
      <SettingsSection title="Build and system"><DiagnosticFacts facts={[
        { name: "Couch version", value: report.build.version, source: report.build.packaged ? "Packaged server" : "Dev server" },
        { name: "Commit", value: report.build.revision, source: "Server build" },
        { name: "Build target", value: report.build.target, source: "Server build" },
        ...report.system,
      ]} /></SettingsSection>
      <SettingsSection title="Player, display and audio">{report.native ? <DiagnosticFacts facts={[
        { name: "App version", value: report.native.build.version, source: "App build" },
        { name: "App commit", value: report.native.build.revision, source: "App build" },
        ...report.native.facts,
      ]} /> : <p className="text-sm text-muted-foreground">{report.nativeError ?? "Not available."}</p>}</SettingsSection>
      <SettingsSection title="Media helpers"><DiagnosticFacts facts={report.helpers.map(helper => ({ name: helper.name, value: helper.version ?? helper.status, source: `${helper.source}. ${helper.error ?? helper.status}` }))} /></SettingsSection>
      <SettingsSection title="Configuration"><DiagnosticFacts facts={report.configuration} /></SettingsSection>
      <SettingsSection title="Sources">{report.sources.length ? <DiagnosticFacts facts={report.sources.map(source => ({ name: source.name, value: source.status, source: source.error ?? "No errors" }))} /> : <p className="text-sm text-muted-foreground">No sources.</p>}</SettingsSection>
      <SettingsSection title="Recent errors" description={`Up to ${report.limits.retentionDays} days or ${report.limits.recentEntries} entries, in UTC. This session started ${diagnosticTime(report.sessionStartedAt)}.`}>
        {report.historyError && <Alert><AlertDescription>{report.historyError}</AlertDescription></Alert>}
        {report.recent.length ? <ol className="flex max-h-96 min-w-0 flex-col overflow-y-auto">{report.recent.map((entry, index) => <li key={index} className="min-w-0 border-b py-2 text-sm break-words">
          <p>{entry.message}</p>
          <p className="text-xs text-muted-foreground">{[diagnosticTime(entry.at), entry.source, entry.sessionId === report.sessionId ? "This session" : "Earlier session", `Build ${entry.build.version ?? "unknown"}`, entry.count > 1 && `${entry.count}×, last ${diagnosticTime(entry.lastAt)}`].filter(Boolean).join(" · ")}</p>
        </li>)}</ol> : <p className="text-sm text-muted-foreground">No recent errors.</p>}
      </SettingsSection>
    </>}
  </div>;
}
