import { boundedBytes, record } from "./iptv-feeds";

export class RecordingError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export type RecordingConnection = { endpoint: string; username: string; password: string; playbackUsername: string; playbackPassword: string; profileId: string };
export type RecordingVerification = { connection: string; id: string; channel: string; start: number; stop: number; phase: "submitted" | "cleanup"; failure: string | null };
export type VerificationStore = { authorize: () => void; load: () => RecordingVerification | null; save: (value: RecordingVerification | null) => void };
export type BackendJob = { uuid: string; channel: string; comment: string; owner: string; start: number; stop: number; sched_status: string; status: string; filesize: number; errorcode: number };
export const backendUuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const fail = (message: string): never => { throw new RecordingError(message, 502); };
export function connectionInput(value: Record<string, unknown>): RecordingConnection {
  const text = (key: string, max: number) => {
    const valueAtKey = value[key];
    if (typeof valueAtKey !== "string" || !valueAtKey || valueAtKey.length > max || /[\u0000-\u001f\u007f]/.test(valueAtKey)) throw new RecordingError("Enter the backend address, two accounts, and recording profile UUID.");
    return valueAtKey;
  };
  const endpoint = text("endpoint", 2048);
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new RecordingError("Enter a valid backend HTTPS address or loopback HTTP address."); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || /[\s\\]/.test(endpoint) || !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new RecordingError("Use a backend HTTPS origin, or HTTP on loopback, without credentials or a path.");
  const username = text("username", 200), playbackUsername = text("playbackUsername", 200), profileId = text("profileId", 32);
  if (username.includes(":") || playbackUsername.includes(":") || username === playbackUsername || !backendUuid(profileId)) throw new RecordingError("Use distinct recorder and read-only playback usernames, and a valid recording profile UUID.");
  return { endpoint: url.origin, username, password: text("password", 4096), playbackUsername, playbackPassword: text("playbackPassword", 4096), profileId };
}

export function createTvheadend(connection: RecordingConnection, shutdown: AbortSignal, request = globalThis.fetch) {
  const headers = (playback: boolean) => ({ Authorization: `Basic ${Buffer.from(`${playback ? connection.playbackUsername : connection.username}:${playback ? connection.playbackPassword : connection.password}`).toString("base64")}` });
  async function call(path: string, data: Record<string, string> = {}, playback = false, signal = shutdown, expectedStatus = 200) {
    const combined = AbortSignal.any([shutdown, signal, AbortSignal.timeout(8_000)]);
    const response = await request(`${connection.endpoint}/api/${path}`, { method: "POST", body: new URLSearchParams(data), headers: headers(playback), redirect: "error", signal: combined });
    if (response.status !== expectedStatus) {
      await response.body?.cancel();
      if (response.status === 401) throw new RecordingError("Backend authentication failed. Check the account and enable HTTP Basic authentication over HTTPS or loopback.", 502);
      if (expectedStatus === 403) throw new RecordingError("Playback needs a separate read-only account that cannot modify this recording.", 409);
      fail("The backend denied or could not complete the recording request.");
    }
    if (expectedStatus === 403) { await response.body?.cancel(); return {}; }
    const bytes = await boundedBytes(response, 4 * 1024 * 1024, combined);
    combined.throwIfAborted();
    let value: unknown;
    try { value = JSON.parse(Buffer.from(bytes).toString()); } catch { return fail("The backend returned an invalid response."); }
    if (!record(value)) return fail("The backend returned an invalid response.");
    return value;
  }
  async function grid(path: string, playback = false, signal = shutdown) {
    const value = await call(path, { limit: "1000" }, playback, signal);
    if (!Array.isArray(value.entries) || !Number.isInteger(value.total) || Number(value.total) > 1000 || Number(value.total) !== value.entries.length || !value.entries.every(record)) return fail("The backend listing is incomplete or exceeds 1,000 entries. Reconciliation is paused.");
    return value.entries as Record<string, unknown>[];
  }
  async function qualify(channels: { uuid: string }[], store: VerificationStore, signal: AbortSignal) {
    const identity = JSON.stringify([connection.endpoint, connection.username, connection.playbackUsername, connection.profileId]);
    let intent = store.load();
    if (intent && intent.connection !== identity) throw new RecordingError("Finish the pending disabled recording check with its original backend and accounts before changing their identity.", 409);
    if (!intent) {
      if (!channels[0]) throw new RecordingError("The backend needs an enabled channel with a service before recording setup can be verified.", 409);
      const start = Math.ceil(Date.now() / 1000) + 86_400;
      intent = { connection: identity, id: crypto.randomUUID(), channel: channels[0].uuid, start, stop: start + 60, phase: "submitted", failure: null };
      signal.throwIfAborted(); store.authorize();
      store.save(intent);
      // Persist the attempt before sending. A missing response never permits
      // another create; the next request reconciles this exact disabled entry.
      await call("dvr/entry/create", { conf: JSON.stringify({ enabled: false, channel: intent.channel, config_name: connection.profileId, start, stop: intent.stop, start_extra: 0, stop_extra: 0, disp_title: "Couch recording permission check", comment: `Couch:permission:${intent.id}` }) }, false, signal).catch(() => {});
    }
    const marker = `Couch:permission:${intent.id}`;
    const matching = (rows: Record<string, unknown>[]) => rows.filter(row => row.comment === marker);
    const rows = matching(await grid("dvr/entry/grid", false, signal));
    if (rows.length > 1) throw new RecordingError("The backend has duplicate disabled permission checks. Its administrator must reconcile them before setup can finish.", 409);
    const row = rows[0];
    if (!row && intent.phase === "submitted") throw new RecordingError("The backend has not confirmed the disabled permission check. Setup remains blocked; retry verification to reconcile it without creating another entry.", 409);
    if (row && (!backendUuid(row.uuid) || row.owner !== connection.username || row.channel !== intent.channel || row.start !== intent.start || row.stop !== intent.stop || row.enabled !== false && row.enabled !== 0 || Number(row.filesize) > 0 || row.sched_status === "recording")) throw new RecordingError("The disabled permission check changed on the backend. Its administrator must resolve it before setup can finish.", 409);
    if (row && intent.phase === "submitted") {
      try {
        const visible = (await grid("dvr/entry/grid", true, signal)).find(item => item.uuid === row.uuid);
        if (!visible || visible.owner !== connection.username || visible.comment !== marker) throw new RecordingError("The playback account needs view-all DVR access to read the recorder account's entries.", 409);
        await call("idnode/save", { node: JSON.stringify({ uuid: row.uuid }) }, true, signal, 403);
      } catch (reason) {
        intent.failure = reason instanceof RecordingError ? reason.message : "Playback permissions could not be verified. Retry setup after checking the backend.";
      }
      intent.phase = "cleanup"; store.save(intent);
    }
    if (row) {
      // Clean up even if this HTTP caller left. The disabled entry cannot
      // capture media, and durable cleanup intent survives an app shutdown.
      await call("dvr/entry/cancel", { uuid: String(row.uuid) }, false, shutdown).catch(() => {});
      if (matching(await grid("dvr/entry/grid", false, shutdown)).length) throw new RecordingError("The disabled permission check still needs backend cleanup. Setup is blocked; retry verification to finish cleanup.", 409);
    }
    store.save(null);
    if (intent.failure) throw new RecordingError(intent.failure, 409);
  }
  return {
    async verify(signal = shutdown, verification?: VerificationStore) {
      for (const playback of [false, true]) {
        const identity = await call("access/whoami", {}, playback, signal);
        if (identity.username !== (playback ? connection.playbackUsername : connection.username) || identity.admin || !identity.dvr) throw new RecordingError("Use authenticated non-administrator recorder and playback accounts with DVR access on Tvheadend API 20 or newer.", 409);
      }
      await call("dvr/entry/class", {}, false, signal);
      const profiles = await grid("dvr/config/grid", false, signal);
      if (!profiles.some(item => item.uuid === connection.profileId)) throw new RecordingError("This recorder account cannot use the selected recording profile.", 409);
      await grid("dvr/entry/grid", true, signal);
      const channels = await this.channels(signal);
      if (verification) await qualify(channels, verification, signal);
      return channels;
    },
    async channels(signal = shutdown) {
      const entries = await grid("channel/grid", false, signal);
      return entries.filter(item => backendUuid(item.uuid) && item.enabled !== false && item.enabled !== 0 && Array.isArray(item.services) && item.services.length > 0).map(item => ({ uuid: item.uuid as string, name: typeof item.name === "string" ? item.name.slice(0, 200) : "Channel" }));
    },
    async jobs(signal = shutdown, playback = false): Promise<BackendJob[]> {
      const rows = await grid("dvr/entry/grid", playback, signal);
      if (!rows.every(row => backendUuid(row.uuid) && typeof row.channel === "string" && typeof row.sched_status === "string" && Number.isFinite(row.start) && Number.isFinite(row.stop))) return fail("The backend returned incomplete recording identities.");
      return rows as BackendJob[];
    },
    async schedule(job: { id: string; title: string; start: number; end: number; backendChannel: string }, signal = shutdown) {
      return call("dvr/entry/create", { conf: JSON.stringify({ enabled: true, channel: job.backendChannel, config_name: connection.profileId, start: job.start / 1000, stop: job.end / 1000, start_extra: 0, stop_extra: 0, disp_title: job.title, comment: `Couch:${job.id}` }) }, false, signal);
    },
    cancel(uuid: string, signal = shutdown) { return call("dvr/entry/cancel", { uuid }, false, signal); },
    async playable(uuid: string, signal: AbortSignal) {
      const row = (await this.jobs(signal, true)).find(item => item.uuid === uuid);
      if (!row || row.sched_status !== "completed" || !(row.filesize > 0) || row.errorcode > 0) throw new RecordingError("This recording is not available for completed playback.", 409);
      // A UUID-only save supplies no changed properties. Its denial checks the
      // same write permission used by Tvheadend's HTTP final-segment reporter.
      await call("idnode/save", { node: JSON.stringify({ uuid }) }, true, signal, 403);
      signal.throwIfAborted();
      return { source: `${connection.endpoint}/dvrfile/${uuid}`, headers: headers(true) };
    },
  };
}
