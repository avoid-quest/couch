export async function verifyTrialTools(verify: () => Promise<void>, wait = () => Bun.sleep(2_000)) {
  try { await verify(); }
  catch { await wait(); await verify(); }
}
