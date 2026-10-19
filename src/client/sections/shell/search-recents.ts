// The last queries typed into the header's field, per Couch, so a TV's remote can reach one without typing it again.
const key = (installationId: string) => `couch.search-recents:${installationId}`;
export const readSearchRecents = (installationId: string): string[] => { try { return JSON.parse(localStorage.getItem(key(installationId)) ?? "[]") as string[]; } catch { return []; } };
export function rememberSearch(installationId: string, query: string) {
  const next = [query, ...readSearchRecents(installationId).filter(entry => entry.toLocaleLowerCase() !== query.toLocaleLowerCase())].slice(0, 8);
  try { localStorage.setItem(key(installationId), JSON.stringify(next)); } catch { /* Recents are best-effort. */ }
  return next;
}
