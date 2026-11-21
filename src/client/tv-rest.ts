let wake: (() => boolean) | null = null;

/** The resting TV's wake (TvRest), set while it waits. */
export function setTvRestWake(handler: (() => boolean) | null) {
  wake = handler;
}

/**
 * A press from a phone's Remote or a controller, which may move focus or click without a key event: it wakes a
 * resting TV, and says whether it did, so that press does nothing else.
 */
export function wakeTvRest() {
  return wake?.() ?? false;
}
