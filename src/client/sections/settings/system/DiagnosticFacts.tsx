import type { ReactNode } from "react";
import type { DiagnosticFact } from "../../../../shared/diagnostics";

/** A divided definition list: name on the left, value and its source on the right. */
export function FactList({ children }: { children: ReactNode }) {
  return <dl className="flex min-w-0 flex-col">{children}</dl>;
}

export function Fact({ name, value, note }: { name: ReactNode; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-x-8 gap-y-0.5 border-b py-2 text-sm md:grid-cols-[14rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="min-w-0 break-words">{value}{note && <span className="block text-xs text-muted-foreground">{note}</span>}</dd>
    </div>
  );
}

export function DiagnosticFacts({ facts }: { facts: DiagnosticFact[] }) {
  return <FactList>{facts.map((fact, index) => <Fact key={index} name={fact.name} value={fact.value === null ? "Unknown" : fact.value.toLocaleString()} note={fact.source} />)}</FactList>;
}
