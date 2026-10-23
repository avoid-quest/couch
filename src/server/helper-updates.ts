import type { HelperUpdate, HelperUpdates } from "../shared/helper-updates";
import { readHelperStatus } from "./helper-status";
import { helpersToUpdate, updateHelper, type Helper } from "./helpers";

// One instance per Core. Reads only inspect its recorded choices; a manual check
// joins the existing per-helper queues, without changing startup or daily checks.
export function createHelperUpdates(directory: string) {
  let state: HelperUpdates = { status: "idle", checkedAt: null, items: [] };
  let running: Promise<void> | null = null;
  const snapshot = () => structuredClone(state);
  const pending = (name: Helper): HelperUpdate => ({ name, version: null, origin: null, status: "checking", error: null });

  async function read(): Promise<HelperUpdates> {
    if (state.status !== "idle") return snapshot();
    const { selected, hold } = await readHelperStatus(directory);
    const items = Object.entries(selected).map(([name, choice]): HelperUpdate => {
      const held = name === "yt-dlp" && hold?.active;
      const behind = choice.latest && (choice.origin === "system" && name !== "yt-dlp"
        || choice.version.localeCompare(choice.latest, "en", { numeric: true }) < 0);
      return {
        name: name as Helper, version: choice.version, origin: choice.origin,
        error: !held && behind ? `The latest ${name} (${choice.latest}) was not selected.` : null,
        status: held ? "held" : behind ? "error"
          : name === "mpv" && choice.origin === "system" ? "system"
          : choice.latest ? "current" : "compatible",
      };
    });
    // A check may have started while the status file was being read.
    return state.status === "idle" ? { ...snapshot(), items } : snapshot();
  }

  async function check(): Promise<HelperUpdates> {
    if (running) return snapshot();
    state = { ...state, status: "checking", items: ["yt-dlp", "qjs", "ffmpeg"].map(name => pending(name as Helper)) };
    running = (async () => {
      const names = await helpersToUpdate(directory);
      state.items = names.map(pending);
      await Promise.all(names.map(async (name, index) => { state.items[index] = await updateHelper(directory, name); }));
    })().catch((error: Error) => {
      state.items = state.items.map(item => item.status === "checking" ? { ...item, status: "error", error: error.message } : item);
    }).finally(() => { state.status = "done"; state.checkedAt = Date.now(); running = null; });
    return snapshot();
  }

  return { read, check, close: () => running ?? Promise.resolve() };
}
