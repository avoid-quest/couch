import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { PlaybackSeekBar } from "../src/client/components/PlaybackSeekBar";

// Run in a browser with the production slider. Only transport acknowledgements
// and playback-clock observations are controlled by this fixture.
export async function runPlaybackSeekRecovery() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const commands: { position: number; resolve: (accepted: boolean) => void }[] = [];
  let update!: (value: number, disabled?: boolean) => void;
  let generation = 0;
  function Fixture({ initial }: { initial: number }) {
    const [state, setState] = useState({ value: initial, disabled: false });
    update = (value, disabled = false) => flushSync(() => setState({ value, disabled }));
    return (
      <PlaybackSeekBar
        value={state.value}
        max={100}
        disabled={state.disabled}
        playbackId={null}
        buffered={null}
        pageFirst={false}
        onCommit={(position) => new Promise((resolve) => commands.push({ position, resolve }))}
      />
    );
  }
  const mount = (initial = 30) => {
    commands.length = 0;
    flushSync(() => root.render(<Fixture key={++generation} initial={initial} />));
  };
  const thumb = () => container.querySelector<HTMLElement>("[role=slider]")!;
  const key = (key = "ArrowRight") => {
    thumb().focus();
    thumb().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  };
  const painted = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  const position = (expected: number, reason: string) => {
    const actual = Number(thumb().getAttribute("aria-valuenow"));
    if (actual !== expected) throw new Error(`${reason}: expected ${expected}, received ${actual}`);
  };
  const targets = (...expected: number[]) => {
    if (commands.map((command) => command.position).join() !== expected.join())
      throw new Error("Keyboard seeks did not accumulate from the latest pending target.");
  };
  try {
    for (const keyName of ["ArrowLeft", "Home"]) {
      mount(0);
      key(keyName);
      commands[0]!.resolve(true);
      await painted();
      update(0);
      update(3);
      position(3, "A no-op seek must not pin the thumb after a throttled clock update");
      key();
      await painted();
      targets(0, 13);
    }

    mount();
    key();
    commands[0]!.resolve(true);
    await painted();
    update(40);
    update(43);
    position(43, "Accepted keyboard seek must follow the advancing clock without losing focus");
    if (document.activeElement !== thumb()) throw new Error("The seek thumb lost keyboard focus.");

    mount(70);
    key("ArrowLeft");
    commands[0]!.resolve(true);
    await painted();
    update(60.4);
    position(60.4, "A backward seek can first report after its target on a throttled clock");
    update(61.4);
    position(61.4, "A backward seek must keep following the advancing clock");

    mount();
    key();
    commands[0]!.resolve(true);
    await painted();
    key("ArrowLeft");
    commands[1]!.resolve(true);
    await painted();
    update(40);
    position(30, "The unchanged old clock must not confirm a reversed pending seek");
    key();
    await painted();
    targets(40, 30, 40);
    commands[2]!.resolve(true);
    await painted();
    update(40.2);
    position(40.2, "The newest reversed seek must release on a new confirmation");

    mount();
    key();
    commands[0]!.resolve(true);
    await painted();
    key();
    await painted();
    targets(40, 50);
    update(40);
    position(50, "An older clock observation must preserve the newer buffered seek");
    commands[1]!.resolve(true);
    await painted();
    update(50);
    update(54);
    position(54, "The confirmed buffered seek must release its draft");
    key();
    commands[2]!.resolve(false);
    await painted();
    targets(40, 50, 64);
    position(54, "A rejected seek must return to the playback clock");

    mount(70);
    key("ArrowLeft");
    commands[0]!.resolve(true);
    await painted();
    key("ArrowLeft");
    await painted();
    targets(60, 50);
    update(60);
    position(50, "An older backward seek must preserve the latest target");
    commands[1]!.resolve(true);
    await painted();
    update(49);
    position(49, "A backward seek must follow the clock after passing its target");
    key();
    key("Escape");
    commands[2]!.resolve(true);
    await painted();
    position(49, "An acknowledgement must not revive an escaped seek");
    key();
    update(49, true);
    commands[3]!.resolve(true);
    await painted();
    update(48);
    position(48, "Disabling seeking must cancel its pending draft");

    mount();
    key();
    key();
    commands[0]!.resolve(false);
    await painted();
    position(50, "A rejected older command must not cancel the latest seek");
    commands[1]!.resolve(true);
    await painted();
    update(51);
    position(51, "Overlapping commands must resume following playback");

    key();
    const retired = commands[2]!;
    mount(70);
    retired.resolve(true);
    await painted();
    position(70, "A retired source's acknowledgement must not change its replacement");
    return { passed: true };
  } finally {
    root.unmount();
    container.remove();
  }
}
