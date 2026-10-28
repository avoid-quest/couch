// On an empty Vite fixture, run runSavedListsRegression(). Reads and writes are isolated fixtures.
import { mountUiAudit } from "./ui-audit.browser";
import type { SavedPlaylist } from "../src/shared/playlists";

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const until = async (condition: () => boolean) => {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Saved lists did not settle");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
const button = (label: string) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label);
  if (!found) throw new Error(`Missing ${label}`);
  return found;
};

export async function runSavedListsRegression() {
  const audit = await mountUiAudit();
  const fixtureFetch = window.fetch;
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const queue = ["played", "current", "next", "later"].map(id => ({ id, title: id, source: `https://example.com/${id}` }));
  const playlist: SavedPlaylist = { id: "audit-list", name: "Sunday listening", revision: 7, updatedAt: 1, source: null, entries: [queue[0]!] };
  window.fetch = async (input, init) => {
    const path = new URL(String(input), location.href).pathname;
    if (path.startsWith("/api/playlists") && init?.method === "POST") {
      writes.push({ path, body: JSON.parse(String(init.body)) });
      return Response.json({ playlist });
    }
    return fixtureFetch(input, init);
  };
  const advance = (currentEntryId: string | null, queueCursorEntryId?: string, connected = true) => audit.updateSession(current => ({
    ...current, connected, state: { ...current.state!, queue, currentEntryId, queueCursorEntryId },
  }));
  try {
    await audit.go("/saved?tab=lists");
    audit.client.setQueryData(["playlists", "detail", playlist.id], { playlist });
    await advance("current", "played");
    assert(!button("Save as list").disabled, "Upcoming entries must enable Save as list");
    button("Save as list").click();
    await until(() => writes.length === 1 && !button("Save as list").disabled);
    assert(writes[0]?.path === "/api/playlists" && writes[0].body.scope === "upNext", "Save as list must explicitly scope its capture");
    document.querySelector<HTMLButtonElement>('[data-playlist-id="audit-list"] [data-play]')!.click();
    await until(() => !![...document.querySelectorAll("button")].find(item => item.textContent === "Update from Up next"));
    await until(() => !!document.activeElement?.matches("[data-back]"));
    button("Update from Up next").focus();
    button("Update from Up next").click();
    await until(() => !!document.querySelector('[role="alertdialog"]'));
    assert(document.querySelector('[role="alertdialog"]')?.textContent?.includes("2 in Up next"), "Confirmation must count only upcoming entries");
    await advance("next", "current");
    assert(document.querySelector('[role="alertdialog"]')?.textContent?.includes("1 in Up next"), "Open confirmation must follow remote advance");
    await advance("later", "next");
    assert(button("Replace").disabled, "Remote exhaustion must disable the open Replace action");
    button("Replace").click();
    assert(writes.length === 1 && !!document.querySelector('[role="alertdialog"]'), "Disabled Replace must neither write nor close");
    button("Cancel").click();
    await until(() => !document.querySelector('[role="alertdialog"]'));
    await until(() => !!document.activeElement?.matches("[data-back]"));
    await advance(null, "next");
    button("Update from Up next").focus();
    button("Update from Up next").click();
    await until(() => !!document.querySelector('[role="alertdialog"]'));
    assert(!button("Replace").disabled, "Stopped cursor with upcoming entries must permit replacement");
    await advance(null, "next", false);
    assert(button("Replace").disabled, "Disconnect must disable the open Replace action");
    await advance(null, "next");
    button("Replace").click();
    await until(() => writes.length === 2 && !document.querySelector('[role="alertdialog"]'));
    assert(writes[1]?.path === `/api/playlists/${playlist.id}` && writes[1].body.revision === 7 && writes[1].body.operation === "saveQueue" && writes[1].body.scope === "upNext", "Replace must send the list revision and explicit Up next scope");
    await advance(null, "later");
    assert(button("Update from Up next").disabled, "Exhausted stopped queue must disable Update from Up next");
    return { passed: true, checks: ["scoped Save as list", "only upcoming entries counted", "remote advance updates open confirmation", "exhaustion blocks Replace without closing", "Cancel restores Lists focus when the opener is disabled", "Stop cursor", "disconnect and reconnect", "scoped Replace with revision"] };
  } finally {
    window.fetch = fixtureFetch;
    audit.close();
  }
}
