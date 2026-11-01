// Import on an empty Vite page with #fixture, then call runPlayerAutoHideRegression().
import { mountPlayerReview } from "./player-status.browser";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };

export async function runPlayerAutoHideRegression() {
  const review = await mountPlayerReview();
  const shown = () => !!document.querySelector('[data-player-band="shown"]');
  const pointer = (type: string, pointerType = "mouse") => document.querySelector(".player-page")!
    .dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType, relatedTarget: null }));
  try {
    await review.state("playing", { video: true });
    pointer("pointermove");
    pointer("pointerout"); // React derives onPointerLeave from pointerout.
    await wait(4300);
    assert(!shown(), "Leaving the window cancelled the playing video's hide timer");
    pointer("pointerout");
    await wait(100);
    assert(!shown(), "Leaving the window revealed hidden controls");

    pointer("pointermove");
    await wait(100);
    assert(shown(), "Moving back into the player did not reveal controls");
    pointer("pointerout", "touch");
    await wait(4300);
    assert(!shown(), "Lifting a finger cancelled the hide timer");

    await review.state("paused", { video: true });
    pointer("pointerout");
    await wait(4300);
    assert(shown(), "Leaving the window hid a paused video's controls");

    await review.state("playing", { video: true });
    const play = document.querySelector<HTMLButtonElement>("[data-play-button]")!;
    play.focus();
    pointer("pointerout");
    await wait(4300);
    assert(shown() && document.activeElement === play, "Leaving hid keyboard-focused controls");
    return "Pointer leave, re-entry, touch, paused playback and keyboard focus passed.";
  } finally { review.close(); }
}
