import { useCallback, useEffect, useMemo, useState } from "react";

// Home's rows, in the order a fresh device shows them. Each device keeps its own choice.
export const homeRowLabels = { now: "Now", continue: "Continue", later: "For later", radio: "Radio", recent: "Played recently", upNext: "Up next" } as const;
export type HomeRowId = keyof typeof homeRowLabels;
export type HomeRow = { id: HomeRowId; shown: boolean };
export const defaultHomeRows: HomeRow[] = [
  { id: "now", shown: true }, { id: "continue", shown: true }, { id: "later", shown: true },
  { id: "radio", shown: true }, { id: "recent", shown: true }, { id: "upNext", shown: false },
];
const storageKey = "couch.home-rows";
let sessionRows: HomeRow[] | null = null;

export function readHomeRows(storage?: Pick<Storage, "getItem">): HomeRow[] {
  if (!storage && sessionRows) return sessionRows;
  try {
    const saved = JSON.parse((storage ?? localStorage).getItem(storageKey) ?? "[]") as HomeRow[];
    const known = saved.filter((row, index) => Object.hasOwn(homeRowLabels, row?.id) && saved.findIndex(other => other.id === row.id) === index).map(row => ({ id: row.id, shown: row.shown !== false }));
    // Rows added after the choice was saved join at their default place at the end.
    return [...known, ...defaultHomeRows.filter(row => !known.some(other => other.id === row.id))];
  } catch { return defaultHomeRows; }
}

export function useHomeRows() {
  const [rows, setRows] = useState(() => readHomeRows());
  useEffect(() => {
    const update = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) { sessionRows = null; setRows(readHomeRows()); } };
    const refresh = () => setRows(readHomeRows());
    window.addEventListener("storage", update);
    window.addEventListener(storageKey, refresh);
    return () => { window.removeEventListener("storage", update); window.removeEventListener(storageKey, refresh); };
  }, []);
  const save = useCallback((next: HomeRow[]) => {
    setRows(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); sessionRows = null; } catch { sessionRows = next; }
    window.dispatchEvent(new Event(storageKey));
  }, []);
  return useMemo(() => ({
    rows,
    toggle: (id: HomeRowId, shown: boolean) => save(rows.map(row => row.id === id ? { ...row, shown } : row)),
    move: (id: HomeRowId, by: -1 | 1) => {
      const from = rows.findIndex(row => row.id === id), to = from + by;
      if (from < 0 || to < 0 || to >= rows.length) return;
      const next = [...rows];
      [next[from], next[to]] = [next[to]!, next[from]!];
      save(next);
    },
    reset: () => save(defaultHomeRows),
  }), [rows, save]);
}
