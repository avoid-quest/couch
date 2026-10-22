import { expect, test } from "bun:test";
import { formatSeen } from "../src/client/time-format";
import { staleDuplicates } from "../src/shared/devices";
import { readVideoQuality, videoQualityOptions } from "../src/client/video-quality";

test("Devices say when they were last seen as people do", () => {
  const now = new Date(2026, 9, 21, 20, 6).getTime();
  const ago = (minutes: number) => formatSeen(now - minutes * 60_000, now);
  expect([ago(0), ago(10), ago(60), ago(5 * 60), ago(20 * 60 + 30)]).toEqual(["just now", "10 min ago", "1 hour ago", "5 hours ago", "yesterday"]);
  expect(formatSeen(new Date(2026, 9, 21, 1, 0).getTime(), new Date(2026, 9, 21, 23, 0).getTime())).toBe("22 hours ago");
  expect(formatSeen(new Date(2026, 9, 20, 23, 0).getTime(), new Date(2026, 9, 21, 1, 0).getTime())).toBe("2 hours ago");
  expect(formatSeen(new Date(2026, 9, 17, 12).getTime(), now)).toBe(new Date(2026, 9, 17).toLocaleDateString(undefined, { weekday: "long" }));
  expect(formatSeen(new Date(2025, 2, 3).getTime(), now)).toContain("2025");
});

test("An offline device named like a newer one is a duplicate left behind", () => {
  const device = (id: string, name: string, lastSeenAt: number | null, role: "host" | "controller" | "administrator" = "controller") => ({ id, name, role, createdAt: null, lastSeenAt });
  const devices = [device("a", "Living room TV", 1), device("b", "Living room TV ", 3), device("c", "living room tv", 2), device("d", "Phone", 1), device("host", "Living room TV", 9, "host"), device("me", "Phone", 0)];
  expect(staleDuplicates(devices, new Set()).map(item => item.id)).toEqual(["a", "c", "me"]);
  // Online beats any time; this device and the host are never offered.
  expect(staleDuplicates(devices, new Set(["a"]), "me").map(item => item.id)).toEqual(["b", "c"]);
});

test("Video quality offers 1080p once", () => {
  expect(videoQualityOptions.map(option => option.label)).toEqual(["Best", "1080p", "720p", "480p"]);
  expect(readVideoQuality({ getItem: () => "1080p" })).toBe("auto");
});
