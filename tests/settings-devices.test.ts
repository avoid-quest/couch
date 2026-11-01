import { expect, test } from "bun:test";
import { staleDuplicates } from "../src/shared/devices";

test("An offline device named like a newer one is a duplicate left behind", () => {
  const device = (
    id: string,
    name: string,
    lastSeenAt: number | null,
    role: "host" | "controller" | "administrator" = "controller",
  ) => ({ id, name, role, createdAt: null, lastSeenAt });
  const devices = [
    device("a", "Living room TV", 1),
    device("b", "Living room TV ", 3),
    device("c", "living room tv", 2),
    device("d", "Phone", 1),
    device("host", "Living room TV", 9, "host"),
    device("me", "Phone", 0),
  ];
  expect(staleDuplicates(devices, new Set()).map((item) => item.id)).toEqual(["a", "c", "me"]);
  // Online beats any time; this device and the host are never offered.
  expect(staleDuplicates(devices, new Set(["a"]), "me").map((item) => item.id)).toEqual(["b", "c"]);
});
