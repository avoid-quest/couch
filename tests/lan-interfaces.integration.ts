import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import type { NetworkInterfaceInfo } from "node:os";
import { promisify } from "node:util";
import { lanInterfacePriorities } from "../src/server/lan-interfaces";
import { createLanListener, selectLan } from "../src/server/lan-listener";

const entry: NetworkInterfaceInfo = { address: "192.168.1.20", family: "IPv4", internal: false, netmask: "255.255.255.0", cidr: "192.168.1.20/24", mac: "00:11:22:33:44:55" };
function platform(t: TestContext, value: NodeJS.Platform) {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value });
  t.after(() => { Object.defineProperty(process, "platform", descriptor); t.mock.restoreAll(); syncBuiltinESMExports(); });
}
function command(t: TestContext, file: string, output: string | Error) {
  const original = childProcess.execFile;
  const run = async (path: string, _args: string[], options: childProcess.ExecFileOptions) => {
    assert.equal(path, file);
    assert.equal(options.windowsHide, true);
    assert.ok(options.timeout! > 0);
    if (output instanceof Error) throw output;
    return { stdout: output, stderr: "" };
  };
  childProcess.execFile = Object.assign(run, { [promisify.custom]: run }) as unknown as typeof childProcess.execFile;
  t.after(() => { childProcess.execFile = original; syncBuiltinESMExports(); });
  syncBuiltinESMExports();
}

for (const wireless of [1, 9]) test(`Windows hardware information handles renamed adapters and Wi-Fi medium ${wireless}`, async t => {
  platform(t, "win32");
  command(t, "powershell.exe", JSON.stringify([
    { Name: "Ethernet", HardwareInterface: false, NdisPhysicalMedium: 14, InterfaceType: 6 },
    { Name: "A radio", HardwareInterface: true, NdisPhysicalMedium: wireless, InterfaceType: 71 },
    { Name: "Z câblé", HardwareInterface: true, NdisPhysicalMedium: 14, InterfaceType: 6 },
  ]));
  const priorities = await lanInterfacePriorities();
  assert.equal(selectLan({ Ethernet: [entry], "A radio": [entry], "Z câblé": [entry] }, undefined, undefined, priorities).name, "Z câblé");
  assert.equal(selectLan({ Ethernet: [entry], "A radio": [entry] }, undefined, undefined, priorities).name, "A radio");

  const starts: string[] = [];
  const lan = createLanListener({
    port: 4100, enabled: true, advertised: [], priorities,
    interfaces: () => ({ Ethernet: [entry], "A radio": [entry], "Z câblé": [entry] }),
    start: async network => { starts.push(network.name); return { stop: async () => {} }; }, changed() {},
  });
  t.after(() => lan.close());
  await lan.refresh();
  assert.deepEqual(starts, ["Z câblé"]);
});

test("Windows supports an older Ethernet driver reporting an unspecified physical medium", async t => {
  platform(t, "win32");
  command(t, "powershell.exe", JSON.stringify([{ Name: "Office", HardwareInterface: true, NdisPhysicalMedium: 0, InterfaceType: 6 }]));
  assert.equal(selectLan({ "Wi-Fi": [entry], Office: [entry] }, undefined, undefined, await lanInterfacePriorities()).name, "Office");
});

test("macOS uses hardware ports so Wi-Fi on en0 follows USB Ethernet", async t => {
  platform(t, "darwin");
  command(t, "/usr/sbin/networksetup", "Hardware Port: Wi-Fi\nDevice: en0\nEthernet Address: 00:11:22:33:44:55\n\nHardware Port: USB 10/100/1000 LAN\nDevice: en7\nEthernet Address: 00:11:22:33:44:66\n\nHardware Port: Thunderbolt Bridge\nDevice: bridge0\n");
  const priorities = await lanInterfacePriorities();
  assert.equal(selectLan({ en0: [entry], bridge0: [entry], en7: [entry] }, undefined, undefined, priorities).name, "en7");
  assert.equal(selectLan({ bridge0: [entry], en0: [entry] }, undefined, undefined, priorities).name, "en0");
});

test("Linux uses sysfs to distinguish renamed wired, wireless and virtual adapters", async t => {
  platform(t, "linux");
  t.mock.method(fs, "readdir", async () => ["radio", "office", "guest", "gone"]);
  t.mock.method(fs, "realpath", async path => {
    const name = String(path).split("/").at(-1);
    if (name === "gone") throw new Error("adapter removed");
    return `/sys/devices/${name === "guest" ? "virtual" : "pci0000:00"}/net/${name}`;
  });
  t.mock.method(fs, "readFile", async path => String(path).endsWith("/type") ? "1\n" : String(path).includes("/radio/") ? "DEVTYPE=wlan\nINTERFACE=radio\n" : "INTERFACE=office\n");
  syncBuiltinESMExports();
  const priorities = await lanInterfacePriorities();
  assert.equal(selectLan({ radio: [entry], guest: [entry], office: [entry] }, undefined, undefined, priorities).name, "office");
  assert.equal(selectLan({ guest: [entry], radio: [entry] }, undefined, undefined, priorities).name, "radio");
  assert.equal(priorities.has("gone"), false);
});

for (const output of [new Error("PowerShell unavailable"), "invalid JSON", "[]"]) test(`missing adapter details still allow automatic LAN selection: ${String(output)}`, async t => {
  platform(t, "win32");
  command(t, "powershell.exe", output);
  const priorities = await lanInterfacePriorities();
  assert.equal(selectLan({ "vEthernet (WSL)": [entry], "Wi-Fi": [entry], Ethernet: [entry] }, undefined, undefined, priorities).name, "Ethernet");
});
