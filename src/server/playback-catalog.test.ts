import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openStore } from "./store";
import { openPlaybackCatalog } from "./playback-catalog";

test("legacy playback stores survive catalog migration and default rotation", () => {
  const directory = mkdtempSync(join(tmpdir(), "couch-playback-catalog-"));
  const databasePath = join(directory, "couch.sqlite");
  const shared = openStore(databasePath);
  const installationId = shared.installationId();
  const personalPath = join(directory, "sessions", `${createHash("sha256").update(`${installationId}:client-a`).digest("hex")}.sqlite`);
  mkdirSync(dirname(personalPath), { recursive: true });
  const personal = openStore(personalPath);
  const householdQueue = [{ id: "household", title: "Household movie", source: "https://example.com/household.mp4" }];
  const personalQueue = [{ id: "personal", title: "Personal movie", source: "https://example.com/personal.mp4" }];
  shared.saveQueue(householdQueue);
  personal.saveQueue(personalQueue);
  let catalog = openPlaybackCatalog(databasePath, installationId);
  try {
    expect(catalog.defaultFor(null)).toEqual({ id: installationId, owner: null, storageKey: null, deviceIds: [] });
    expect(catalog.defaultFor("client-a")).toEqual({ id: "personal:client-a", owner: "client-a", storageKey: "client-a", deviceIds: [] });
    const next = catalog.create("client-a");
    expect(next.id).toMatch(/^playback:/);
    expect(next).toEqual({ id: next.id, owner: "client-a", storageKey: next.id, deviceIds: [] });
    expect(catalog.assign(next.id, ["living-room", "kitchen"]).deviceIds).toEqual(["living-room", "kitchen"]);
    const host = catalog.create(null);
    expect(host).toMatchObject({ owner: null, storageKey: host.id });
    expect(catalog.defaultFor("client-a").id).toBe(next.id);
    expect(catalog.defaultFor(null).id).toBe(host.id);
    expect(catalog.defaultFor("client-b").id).toBe("personal:client-b");

    catalog.close();
    catalog = openPlaybackCatalog(databasePath, installationId);
    expect(catalog.defaultFor("client-a").id).toBe(next.id);
    expect(catalog.get(next.id)?.deviceIds).toEqual(["living-room", "kitchen"]);
    expect(catalog.all().map(record => record.id)).toEqual([installationId, "personal:client-a", next.id, host.id, "personal:client-b"]);
    expect(catalog.get("personal:client-a")?.storageKey).toBe("client-a");
    const reopenedShared = openStore(databasePath);
    const reopenedPersonal = openStore(personalPath);
    try {
      expect(reopenedShared.queue).toEqual(householdQueue);
      expect(reopenedPersonal.queue).toEqual(personalQueue);
    } finally { reopenedShared.close(); reopenedPersonal.close(); }
  } finally {
    catalog.close(); personal.close(); shared.close(); rmSync(directory, { recursive: true, force: true });
  }
});
