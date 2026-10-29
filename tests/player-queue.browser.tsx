// Run on the Vite UI fixture: real player/queue components and recorded session commands.
import { mountUiAudit } from "./ui-audit.browser";
import { readArt } from "../src/client/artwork-light";
import { isTvPresentation } from "../src/client/session/presentation";

export async function runPlayerQueueRegression() {
  const audit = await mountUiAudit();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ee5522";
  context.fillRect(0, 0, 32, 32);
  const thumbnail = URL.createObjectURL(await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!))));
  await readArt(thumbnail);
  const checks: string[] = [];
  const failures: string[] = [];
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); checks.push(name); } catch (error) { failures.push(`${name}: ${String(error)}`); }
  };
  try {
    await audit.go("/now?queue=true", { player: "playing", video: true });
    await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, queue: gate.state!.queue.map(entry => ({ ...entry, thumbnail })), autoplay: {
      enabled: true, contextTitle: "Tiny Desk concerts", upcoming: [
        { id: "autoplay-one", title: "First recommendation", source: "web:https://www.youtube.com/watch?v=one" },
        { id: "autoplay-two", title: "Second recommendation", source: "web:https://www.youtube.com/watch?v=two" },
      ],
    } } }));
    await check("windowed video has black letterbox bars", async () => {
      assert(!document.querySelector(".player-page .ambient-light, .player-page .room"), "Video still paints artwork color behind the picture");
      assert(getComputedStyle(document.querySelector(".player-page")!).backgroundColor === "rgb(0, 0, 0)", "Video background is not black");
      for (const selector of [".player-video", ".player-video video"]) {
        assert(["rgba(0, 0, 0, 0)", "rgb(0, 0, 0)"].includes(getComputedStyle(document.querySelector(selector)!).backgroundColor), "Video surface paints a non-black margin");
      }
    });
    if (!isTvPresentation()) await check("fullscreen video keeps black letterbox bars", async () => {
      await audit.click("Enter fullscreen");
      assert(document.fullscreenElement, "Player did not enter fullscreen");
      assert(!document.querySelector(".player-page .ambient-light, .player-page .room"), "Fullscreen video paints artwork color");
      await audit.click("Exit fullscreen");
      assert(!document.fullscreenElement, "Player did not exit fullscreen");
    });
    await check("manually queued items play directly", async () => {
      const button = document.querySelector<HTMLButtonElement>('[data-queue-entry-id="next"] [data-play]');
      assert(button && !button.disabled, "Queued row has no enabled Play target");
      button!.click();
      assert(audit.actions.at(-1)?.type === "play" && (audit.actions.at(-1) as { entryId: string }).entryId === "next", "Queued Play did not target the selected entry");
    });
    await check("any autoplay recommendation plays directly", async () => {
      const button = document.querySelector<HTMLButtonElement>('[data-queue-entry-id="autoplay-two"] [data-play]');
      assert(button && !button.disabled, "Autoplay row has no enabled Play target");
      button!.click();
      assert(audit.actions.at(-1)?.type === "play" && (audit.actions.at(-1) as { entryId: string }).entryId === "autoplay-two", "Autoplay Play did not target the selected entry");
      assert(button!.getAttribute("aria-label") === "Play Second recommendation", "Play label implies a scheduled action");
    });
    await check("connected but unavailable playback disables Autoplay Play", async () => {
      await audit.updateSession(gate => ({ ...gate, connected: true, state: { ...gate.state!, player: { ...gate.state!.player, status: "unavailable" } } }));
      const button = document.querySelector<HTMLButtonElement>('[data-queue-entry-id="autoplay-two"] [data-play]');
      assert(button?.disabled, "Unavailable playback still offers Autoplay Play");
      const before = audit.actions.length;
      button!.click();
      assert(audit.actions.length === before, "Unavailable playback sent a command");
      await audit.updateSession(gate => ({ ...gate, state: { ...gate.state!, player: { ...gate.state!.player, status: "playing" } } }));
    });
    await check("disconnected queues cannot send playback commands", async () => {
      await audit.updateSession(gate => ({ ...gate, connected: false }));
      const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-queue-entry-id] [data-play]")];
      assert(buttons.length === 3 && buttons.every(button => button.disabled), "A disconnected queue still offers Play");
      const before = audit.actions.length;
      buttons.forEach(button => button.click());
      assert(audit.actions.length === before, "Disconnected Play sent a command");
    });
    await check("radio retains the artwork room", async () => {
      await audit.go("/now", { player: "playing", live: true });
      assert(document.querySelector(".player-page .room"), "Radio lost its artwork room");
      assert(!document.documentElement.scrollWidth || document.documentElement.scrollWidth <= innerWidth, "Player overflows horizontally");
    });
    return { checks, failures };
  } finally { audit.close(); URL.revokeObjectURL(thumbnail); }
}
