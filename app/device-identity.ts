import { loadSendspinClientIdentity } from "@sendspin/sendspin-js";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { defaultDeviceSharing, isDeviceSharing, normalizeDeviceName, type DeviceIdentityUpdate, type LocalDeviceIdentity } from "../src/shared/device-identity";

/** Main owns one identity across the server origins loaded in its window. */
export function createDeviceIdentity(path: string) {
  let saved: Partial<LocalDeviceIdentity>;
  try { saved = JSON.parse(readFileSync(path, "utf8")) ?? {}; } catch { saved = {}; }
  return (update: DeviceIdentityUpdate = {}): LocalDeviceIdentity => {
    let key = typeof saved.key === "string" ? saved.key : undefined;
    let name: string | null = null;
    if (update.name !== undefined) name = normalizeDeviceName(update.name);
    else if (saved.name) { try { name = normalizeDeviceName(saved.name); } catch { /* Recover malformed saved names. */ } }
    if (update.sharing !== undefined && !isDeviceSharing(update.sharing)) throw new Error("Choose which features to share.");
    loadSendspinClientIdentity({
      getItem: field => field === "sendspin-identity-sk" ? key ?? update.key ?? null : null,
      setItem: (field, value) => { if (field === "sendspin-identity-sk") key = value; },
    });
    // The SDK may reuse a migrated key without calling setItem.
    key ??= update.key;
    const next = { key: key!, name, sharing: update.sharing ?? (isDeviceSharing(saved.sharing) ? saved.sharing : defaultDeviceSharing) };
    writeFileSync(`${path}.tmp`, JSON.stringify(next), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
    saved = next;
    return next;
  };
}
