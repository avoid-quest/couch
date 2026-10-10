import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { isIP } from "node:net";
import { promisify } from "node:util";

// resolv.conf uses the last search/domain directive; LOCALDOMAIN overrides it.
export function resolverSearchDomains(text: string, localDomain?: string) {
  let domains: string[] = [];
  for (const line of text.split("\n")) {
    const [key, ...values] = line.replace(/[;#].*$/, "").trim().split(/\s+/);
    if (key === "search" || key === "domain") domains = key === "domain" ? values.slice(0, 1) : values;
  }
  return localDomain === undefined ? domains : localDomain.trim().split(/\s+/);
}
export function lanNames(host: string, domains: string[]) {
  const full = host.toLowerCase().replace(/\.$/, ""), short = full.split(".")[0]!;
  const names = [...domains.map(domain => `${short}.${domain.toLowerCase().replace(/\.$/, "")}`), ...full.includes(".") ? [full] : []];
  return [...new Set(names)].filter(name => !isIP(name) && name.length <= 253 && name.split(".").every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)));
}
export async function systemLanNames() {
  let domains: string[] = [];
  const run = async (file: string, args: string[]) => (await promisify(execFile)(file, args, { encoding: "utf8", timeout: 3000, maxBuffer: 64 * 1024, windowsHide: true })).stdout;
  try {
    if (process.platform === "linux") domains = resolverSearchDomains(await readFile("/etc/resolv.conf", "utf8").catch(() => ""), process.env.LOCALDOMAIN);
    else if (process.platform === "darwin") domains = [...(await run("/usr/sbin/scutil", ["--dns"])).matchAll(/^\s*search domain\[\d+\]\s*:\s*(\S+)/gm)].map(match => match[1]!);
    else if (process.platform === "win32") {
      const value: unknown = JSON.parse(await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "@((Get-DnsClientGlobalSetting).SuffixSearchList; (Get-DnsClient).ConnectionSpecificSuffix) | Where-Object { $_ } | ConvertTo-Json -Compress"]));
      domains = (Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === "string");
    }
  } catch { /* Missing resolver settings leave the qualified hostname and IP fallback. */ }
  return lanNames(hostname(), domains);
}
