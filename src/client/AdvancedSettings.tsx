import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { DiagnosticFact, Diagnostics } from "../shared/diagnostics";

function Facts({ facts }: { facts: DiagnosticFact[] }) {
  return <dl className="divide-y rounded-lg border px-3">{facts.map((fact, index) => <div key={index} className="min-w-0 py-2">
    <dt className="text-xs text-muted-foreground">{fact.name}</dt>
    <dd className="break-words">{fact.value === null ? "Unknown" : fact.value.toLocaleString()}<p className="mt-1 break-words text-xs text-muted-foreground">{fact.source}</p></dd>
  </div>)}</dl>;
}

export function AdvancedSettings({ credentials, connected }: { credentials: { origin: string; token: string }; connected: boolean }) {
  const [report, setReport] = useState<Diagnostics | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { origin, token } = credentials;

  useEffect(() => {
    setReport(null); setError(null); setNotice(null);
    if (!connected) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    void fetch(`${origin}/api/diagnostics`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<Diagnostics>; })
      .then(value => { if (!controller.signal.aborted) setReport(value); })
      .catch(() => { if (!controller.signal.aborted) setError("Could not load diagnostics. Check the connection and administrator access, then refresh."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [connected, origin, token, refresh]);

  useEffect(() => {
    if (!exporting || !connected) return;
    const controller = new AbortController();
    setError(null); setNotice(null);
    void fetch(`${origin}/api/diagnostics/export`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then(async response => {
        if (!response.ok) throw new Error();
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url; link.download = "couch-diagnostics.json";
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
        setNotice("Diagnostic download started.");
      })
      .catch(() => { if (!controller.signal.aborted) setError("Could not export diagnostics. Check the connection and administrator access, then try again."); })
      .finally(() => { if (!controller.signal.aborted) setExporting(false); });
    return () => { controller.abort(); };
  }, [exporting, connected, origin, token]);

  useEffect(() => { setExporting(false); }, [connected, origin, token]);

  return <div className="min-w-0 space-y-4" data-advanced-settings>
    <p className="text-muted-foreground">System details and diagnostics.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" className="min-h-11" disabled={!connected || loading || exporting} onClick={() => setRefresh(value => value + 1)}><RefreshCw aria-hidden="true" />Refresh</Button>
      <Button variant="outline" className="min-h-11" disabled={!connected || loading || exporting || !report} onClick={() => setExporting(true)}><Download aria-hidden="true" />{exporting ? "Exporting…" : "Export diagnostics"}</Button>
    </div>
    <p className="text-xs text-muted-foreground">Downloads diagnostics with URLs and credentials removed.</p>
    {!connected && <p role="status">Connect to the TV to load diagnostics.</p>}
    {loading && <p role="status">Loading diagnostics…</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <p role="status">{notice}</p>}
    {report && <>
      <p className="text-xs text-muted-foreground">Collected {new Date(report.collectedAt).toLocaleString()}. Helper checks are cached for up to {report.limits.helperSeconds / 60} minutes.</p>
      <section className="space-y-2"><h3 className="font-medium">Build and system</h3><Facts facts={[
        { name: "Couch version", value: report.build.version, source: report.build.packaged ? "Packaged coordinator" : "Development coordinator" },
        { name: "Commit", value: report.build.revision, source: "Coordinator build" },
        { name: "Build target", value: report.build.target, source: "Coordinator build" },
        ...report.system,
      ]} /></section>
      <section className="space-y-2"><h3 className="font-medium">Native player, display and audio</h3>{report.native ? <Facts facts={[
        { name: "Native version", value: report.native.build.version, source: "Native host build" },
        { name: "Native commit", value: report.native.build.revision, source: "Native host build" },
        ...report.native.facts,
      ]} /> : <p className="text-muted-foreground">{report.nativeError ?? "Native details are unavailable."}</p>}</section>
      <section className="space-y-2"><h3 className="font-medium">Media helpers</h3><Facts facts={report.helpers.map(helper => ({ name: helper.name, value: helper.version ?? helper.status, source: `${helper.source}. ${helper.error ?? helper.status}` }))} /></section>
      <section className="space-y-2"><h3 className="font-medium">Effective configuration</h3><Facts facts={report.configuration} /></section>
      <section className="space-y-2"><h3 className="font-medium">Sources</h3>{report.sources.length ? <Facts facts={report.sources.map(source => ({ name: source.name, value: source.status, source: source.error ?? "No error reported" }))} /> : <p className="text-muted-foreground">No source status is available.</p>}</section>
      <section className="space-y-2"><h3 className="font-medium">Recent errors</h3><p className="text-xs text-muted-foreground">Errors from this session.</p>{report.recent.length ? <ol className="max-h-72 space-y-3 overflow-y-auto rounded-lg border p-3">{report.recent.map((entry, index) => <li key={index} className="min-w-0 break-words"><p className="text-xs text-muted-foreground">{new Date(entry.at).toLocaleTimeString()} · {entry.source}</p><p>{entry.message}</p></li>)}</ol> : <p className="text-muted-foreground">No recent errors recorded.</p>}</section>
    </>}
  </div>;
}
