import { execFile } from "node:child_process";
import { readFile, readdir, realpath } from "node:fs/promises";
import { promisify } from "node:util";

// Ethernet, Wi-Fi, other, virtual. Use hardware information: interface names
// can be renamed on Windows, and en0 can be either Ethernet or Wi-Fi on macOS.
export async function lanInterfacePriorities() {
  const priorities = new Map<string, number>();
  const run = async (file: string, args: string[]) => (await promisify(execFile)(file, args, { encoding: "utf8", timeout: 3000, maxBuffer: 64 * 1024, windowsHide: true })).stdout;
  try {
    if (process.platform === "win32") {
      const adapters: { Name: string; HardwareInterface: boolean; NdisPhysicalMedium: number; InterfaceType: number }[] = JSON.parse(await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ConvertTo-Json -Compress -InputObject @(Get-NetAdapter | Select-Object Name, HardwareInterface, NdisPhysicalMedium, InterfaceType)",
      ]));
      // NDIS physical media: 1/9 = Wi-Fi, 14 = Ethernet; older wired drivers
      // can report unspecified (0) with Ethernet's interface type (6).
      for (const adapter of adapters) priorities.set(adapter.Name, !adapter.HardwareInterface ? 3 : [1, 9].includes(adapter.NdisPhysicalMedium) ? 1 : adapter.NdisPhysicalMedium === 14 || (adapter.NdisPhysicalMedium === 0 && adapter.InterfaceType === 6) ? 0 : 2);
    } else if (process.platform === "darwin") {
      const output = await run("/usr/sbin/networksetup", ["-listallhardwareports"]);
      for (const [, port, name] of output.matchAll(/Hardware Port: ([^\r\n]+)\r?\nDevice: ([^\s]+)/g)) {
        priorities.set(name!, /Wi-Fi|AirPort/i.test(port!) ? 1 : /Ethernet|\bLAN\b/i.test(port!) ? 0 : 2);
      }
    } else if (process.platform === "linux") {
      await Promise.all((await readdir("/sys/class/net")).map(async name => {
        try {
          const path = await realpath(`/sys/class/net/${name}`);
          const [details, type] = await Promise.all([readFile(`${path}/uevent`, "utf8"), readFile(`${path}/type`, "utf8")]);
          priorities.set(name, /^DEVTYPE=wlan$/m.test(details) ? 1 : path.includes("/virtual/") ? 3 : type.trim() === "1" && !/^DEVTYPE=/m.test(details) ? 0 : 2);
        } catch { /* An adapter can disappear while it is being inspected. */ }
      }));
    }
  } catch { /* Selection falls back to conventional interface names. */ }
  return priorities;
}
