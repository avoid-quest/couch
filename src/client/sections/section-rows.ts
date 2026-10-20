import { useCallback, useEffect, useMemo, useState } from "react";

export type SectionRow<Id extends string = string> = { id: Id; shown: boolean };
const sessionRows = new Map<string, SectionRow[]>();

export function readSectionRows<Id extends string>(storageKey: string, defaults: SectionRow<Id>[], storage?: Pick<Storage, "getItem">): SectionRow<Id>[] {
  if (!storage && sessionRows.has(storageKey)) return sessionRows.get(storageKey) as SectionRow<Id>[];
  try {
    const saved = JSON.parse((storage ?? localStorage).getItem(storageKey) ?? "[]") as SectionRow<Id>[];
    const known = saved.filter((row, index) => defaults.some(item => item.id === row?.id) && saved.findIndex(other => other.id === row.id) === index).map(row => ({ id: row.id, shown: row.shown !== false }));
    // Rows added after the choice was saved join at their default place at the end.
    return [...known, ...defaults.filter(row => !known.some(other => other.id === row.id))];
  } catch { return defaults; }
}

export function useSectionRows<Id extends string>(storageKey: string, defaults: SectionRow<Id>[]) {
  const [rows, setRows] = useState(() => readSectionRows(storageKey, defaults));
  useEffect(() => {
    const update = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) { sessionRows.delete(storageKey); setRows(readSectionRows(storageKey, defaults)); } };
    const refresh = () => setRows(readSectionRows(storageKey, defaults));
    window.addEventListener("storage", update);
    window.addEventListener(storageKey, refresh);
    return () => { window.removeEventListener("storage", update); window.removeEventListener(storageKey, refresh); };
  }, [storageKey, defaults]);
  const save = useCallback((next: SectionRow<Id>[]) => {
    setRows(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); sessionRows.delete(storageKey); } catch { sessionRows.set(storageKey, next); }
    window.dispatchEvent(new Event(storageKey));
  }, [storageKey, defaults]);
  return useMemo(() => ({
    rows,
    toggle: (id: Id, shown: boolean) => save(rows.map(row => row.id === id ? { ...row, shown } : row)),
    move: (id: Id, by: -1 | 1) => {
      const from = rows.findIndex(row => row.id === id), to = from + by;
      if (from < 0 || to < 0 || to >= rows.length) return;
      const next = [...rows];
      [next[from], next[to]] = [next[to]!, next[from]!];
      save(next);
    },
    reset: () => save(defaults),
  }), [rows, save]);
}

