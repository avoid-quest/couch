export async function checkpointAppImage(options: {
  whenIdle: boolean;
  work?: () => string | null;
  confirmInterrupt: boolean;
  idle: () => string | null;
  player: () => string;
  closeAdmission: () => void;
  quiesce: () => Promise<{ progressSaved: boolean; admissionClosed: boolean }>;
}) {
  let closed = false;
  try {
    const waiting = options.work?.() ?? (options.whenIdle ? options.idle() : null);
    if (waiting) throw new Error(waiting);
    if (!options.confirmInterrupt && !["idle", "ended", "error"].includes(options.player())) throw new Error("Confirm interruption of current playback before installing.");
    options.closeAdmission();
    closed = true;
    const checkpoint = await options.quiesce();
    if (!checkpoint.progressSaved || !checkpoint.admissionClosed) throw new Error("The data checkpoint did not confirm stopped writers and saved progress.");
    return { closed, error: null };
  } catch (error) { return { closed, error: error instanceof Error ? error.message : "The data checkpoint failed." }; }
}
