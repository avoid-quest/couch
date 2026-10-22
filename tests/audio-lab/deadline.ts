export function remainingTime(deadline: number, label: string) {
  const remaining = deadline - performance.now();
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error(`Timed out: ${label}`);
  return remaining;
}

/** Dispose the request registration on success, failure, or deadline expiry. */
export async function requestBeforeDeadline<T>(deadline: number, label: string,
  start: (resolve: (value: T) => void, reject: (error: Error) => void) => () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined, dispose: (() => void) | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), remainingTime(deadline, label));
      dispose = start(value => {
        try { remainingTime(deadline, label); resolve(value); }
        catch (error) { reject(error); }
      }, reject);
    });
  } finally { clearTimeout(timer); dispose?.(); }
}

export async function waitUntil(test: (deadline: number) => boolean | Promise<boolean>, label: string, deadline: number) {
  while (true) {
    const ready = await requestBeforeDeadline<boolean>(deadline, label, (resolve, reject) => {
      Promise.resolve().then(() => { remainingTime(deadline, label); return test(deadline); }).then(resolve, reject);
      return () => {};
    });
    if (ready) return;
    await Bun.sleep(Math.min(50, remainingTime(deadline, label)));
  }
}
