import type { ControllerIdentity } from "../shared/controllers";
import type { DiagnosticFact, DiagnosticHelper, Diagnostics, NativeDiagnostics } from "../shared/diagnostics";
import { buildInfo } from "./build-info";
import { createDiagnosticLog, diagnosticLimits, redactDiagnosticText } from "./diagnostics-redaction";
import { configurationFacts, diagnosticBuild, helperFacts, systemFacts } from "./diagnostics-system";

type Options = {
  databasePath: string;
  runtime: () => { hostname: string; port: number; native: boolean };
  native: () => Promise<NativeDiagnostics | null>;
  sources: () => { name: string; status: string; error?: string | null; warning?: string | null }[];
  secrets?: string[];
  env?: NodeJS.ProcessEnv;
  system?: () => Promise<DiagnosticFact[]>;
  helpers?: () => Promise<DiagnosticHelper[]>;
};

export function createDiagnostics(options: Options) {
  const env = options.env ?? process.env;
  const log = createDiagnosticLog(options.secrets);
  let cached: Diagnostics | null = null;
  let pending: Promise<Diagnostics> | null = null;
  let systemPending: Promise<DiagnosticFact[]> | null = null;
  let helpers: { at: number; values: DiagnosticHelper[] } | null = null;
  const safe = (value: unknown, maximum?: number) => redactDiagnosticText(value, options.secrets, maximum);
  const facts = (values: DiagnosticFact[]) => values.slice(0, 40).map(fact => ({ name: safe(fact.name, 80), source: safe(fact.source), value: typeof fact.value === "number" ? Number.isFinite(fact.value) ? fact.value : null : fact.value === null ? null : safe(fact.value) }));

  async function boundedSystem(): Promise<DiagnosticFact[]> {
    // Keep one unfinished OS probe after a timeout; repeated refreshes must not
    // accumulate filesystem work when a data mount has stopped answering.
    systemPending ??= Promise.resolve().then(options.system ?? (() => systemFacts(options.databasePath))).finally(() => { systemPending = null; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([systemPending, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("System information timed out")), 1_500); })]);
    } catch { return [{ name: "System details", value: null, source: "System information is unavailable or did not answer within 1.5 seconds" }]; }
    finally { clearTimeout(timer); }
  }

  async function collect(): Promise<Diagnostics> {
    const start = performance.now();
    const [system, native, mediaHelpers] = await Promise.all([
      boundedSystem(),
      options.native().then(value => ({ value, error: value ? null : "Native host is not connected." })).catch(error => ({ value: null, error: safe(error instanceof Error ? error.message : "Native host is unavailable.") })),
      helpers && Date.now() - helpers.at < diagnosticLimits.helperSeconds * 1_000 ? helpers.values : (options.helpers ?? (() => helperFacts(env)))().then(values => { helpers = { at: Date.now(), values }; return values; }).catch(() => [{ name: "Media helpers", version: null, status: "error" as const, source: "Local helper check", error: "Helper information is unavailable.", checkedAt: new Date().toISOString() }]),
    ]);
    for (const helper of mediaHelpers) if (helper.error) log.add(helper.name, helper.error);
    let sources: Diagnostics["sources"];
    try { sources = options.sources().slice(0, 40).map(source => ({ name: safe(source.name, 100), status: safe(source.status, 60), error: source.error || source.warning ? safe([source.error, source.warning].filter(Boolean).join(" ")) : null })); }
    catch { sources = [{ name: "Sources", status: "unavailable", error: "Source status could not be read." }]; }
    for (const source of sources) if (source.error) log.add(source.name, source.error);
    return {
      formatVersion: 1, collectedAt: new Date().toISOString(), collectionMs: Math.round(performance.now() - start), build: diagnosticBuild(buildInfo),
      system: facts(system), native: native.value && { build: diagnosticBuild(native.value.build), facts: facts(native.value.facts) }, nativeError: native.error,
      helpers: mediaHelpers.slice(0, 8).map(helper => ({ name: safe(helper.name, 60), version: helper.version ? safe(helper.version, 100) : null, status: helper.status, source: safe(helper.source), error: helper.error ? safe(helper.error) : null, checkedAt: helper.checkedAt })),
      configuration: facts(configurationFacts(env, options.runtime())), sources, recent: log.recent(), limits: diagnosticLimits,
    };
  }

  return {
    log,
    async handle(request: Request, identity: () => ControllerIdentity | null): Promise<Response> {
      const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
      const json = (body: unknown, status: number) => Response.json(body, { status, headers });
      const permitted = () => identity()?.authority === "administrator";
      if (!permitted()) return json({ error: "An administrator remote is required to view diagnostics." }, 403);
      if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } });
      const path = new URL(request.url).pathname;
      if (path !== "/api/diagnostics" && path !== "/api/diagnostics/export") return json({ error: "Not found." }, 404);
      if (!cached || Date.now() - Date.parse(cached.collectedAt) >= diagnosticLimits.snapshotSeconds * 1_000) {
        pending ??= collect().then(report => { cached = report; return report; }).finally(() => { pending = null; });
        await pending;
      }
      // Revocation while a helper or the native host answers must take effect.
      if (!permitted()) return json({ error: "Administrator access is no longer available." }, 403);
      const body = JSON.stringify({ ...cached!, recent: log.recent() }, null, 2);
      if (Buffer.byteLength(body) > diagnosticLimits.exportBytes) return json({ error: "Diagnostic report exceeded its size limit." }, 503);
      if (path.endsWith("/export")) headers["Content-Disposition"] = 'attachment; filename="couch-diagnostics.json"';
      headers["Content-Type"] = "application/json; charset=utf-8";
      return new Response(body, { headers });
    },
  };
}
