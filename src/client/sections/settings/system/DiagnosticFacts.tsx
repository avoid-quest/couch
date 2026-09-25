import type { DiagnosticFact } from "../../../../shared/diagnostics";

export function DiagnosticFacts({ facts }: { facts: DiagnosticFact[] }) {
  return (
    <dl className="divide-y divide-border">
      {facts.map((fact, index) => (
        <div key={index} className="min-w-0 py-2">
          <dt className="text-xs text-muted-foreground">{fact.name}</dt>
          <dd className="break-words">{fact.value === null ? "Unknown" : fact.value.toLocaleString()}<p className="mt-1 break-words text-xs text-muted-foreground">{fact.source}</p></dd>
        </div>
      ))}
    </dl>
  );
}
