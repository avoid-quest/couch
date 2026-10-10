import { lookup } from "node:dns/promises";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

export type LanNetwork = { name: string; address: string; netmask: string };
const ipv4 = (value: string) => {
  const parts = value.replace(/^::ffff:/, "").split(".");
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255) ? parts.reduce((value, part) => (value * 256 + Number(part)) >>> 0, 0) : null;
};
export const loopbackPeer = (value: string) => value === "::1" || /^127\./.test(value.replace(/^::ffff:/, ""));
export function lanPeer(network: LanNetwork, peer: string) {
  const address = ipv4(network.address), mask = ipv4(network.netmask), value = ipv4(peer);
  return address !== null && mask !== null && value !== null && (address & mask) === (value & mask);
}
export function selectLan(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>, selected?: string, address?: string): LanNetwork {
  const networks = Object.entries(interfaces).flatMap(([name, entries]) => (entries ?? []).filter(entry => entry.family === "IPv4" && !entry.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address) && (!address || entry.address === address) && (selected ? name === selected : !/^(docker|br-|veth|virbr|tun|tap|utun)/.test(name))).map(entry => ({ name, address: entry.address, netmask: entry.netmask })));
  if (networks.length === 0) throw new Error(selected || address ? "No eligible LAN address matches COUCH_LAN_INTERFACE/COUCH_LAN_ADDRESS. Check that the selected private IPv4 address is assigned locally." : "No eligible LAN address. Connect to a private IPv4 LAN before sharing on your network.");
  if (networks.length !== 1) throw new Error("Several LAN addresses are available. Select a network with COUCH_LAN_INTERFACE; if it has multiple addresses, also set COUCH_LAN_ADDRESS to one of its private IPv4 addresses and restart Couch.");
  return networks[0]!;
}
// The LAN reaches Couch over HTTPS on its port (#644 ticket 8). A saved http:// name keeps
// working: plain HTTP, including a bare name on port 80, redirects there.
export function secureOrigin(value: string, port: number) {
  const url = new URL(value);
  if (url.protocol === "https:") return url.origin;
  url.protocol = "https:";
  url.port = String(port);
  return url.origin;
}
export async function lanUrls(network: LanNetwork, port: number, advertised: string[], resolve = lookup, port80 = false) {
  const ip = `https://${network.address}:${port}`;
  const results = await Promise.all(advertised.map(async (value, index) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const url = new URL(value);
      const aliasPort = Number(url.port || (url.protocol === "https:" ? 443 : 80));
      if (!["http:", "https:"].includes(url.protocol) || (aliasPort !== port && (aliasPort !== 80 || url.protocol !== "http:")) || url.pathname !== "/" || url.username || url.password || url.search || url.hash || /[\s\\]/.test(value)) throw new Error("Use Couch's port, without credentials, a proxy or a path.");
      if (aliasPort === 80 && port !== 80 && !port80) throw new Error("Couch can't use port 80. Add Couch's port to the address.");
      const answers = await Promise.race([
        resolve(url.hostname, { all: true }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("LAN DNS lookup timed out.")), 5_000); }),
      ]);
      if (!answers.length || answers.some(answer => answer.address !== network.address)) throw new Error("The name does not resolve only to the selected Couch address.");
      return { url: secureOrigin(url.origin, port) };
    } catch (error) {
      return { error: `Custom LAN address ${index + 1} was ignored: ${error instanceof Error ? error.message : "DNS lookup failed."}` };
    } finally { clearTimeout(timer); }
  }));
  const errors = results.flatMap(result => result.error ? [result.error] : []);
  return { urls: [...new Set([...results.flatMap(result => result.url ? [result.url] : []), ip])], error: errors.length ? `${errors.join(" ")} Direct IP access remains available. Check COUCH_ADVERTISE_URLS and LAN DNS.` : null };
}

export function createLanListener<T extends { stop(): Promise<void> }>(options: {
  port: number; enabled: boolean; selected?: string; address?: string; advertised: string[] | (() => string[]);
  suggested?: () => string[];
  start: (network: LanNetwork, port: number) => Promise<T>;
  changed: (urls: string[], error: string | null, suggested: string) => void;
  interfaces?: typeof networkInterfaces;
  resolve?: typeof lookup;
}) {
  let enabled = options.enabled, closed = false, active: T | null = null, port80: T | null = null, network: LanNetwork | null = null;
  let pending: Promise<void> = Promise.resolve();
  let last = "";
  const selectedNetwork = () => selectLan((options.interfaces ?? networkInterfaces)(), options.selected, options.address);
  const stopAll = async () => { await Promise.all([active?.stop(), port80?.stop()]); active = port80 = null; };
  const changed = (urls: string[], error: string | null, suggested = "") => {
    const state = JSON.stringify([urls, error, suggested]);
    if (last !== state) { last = state; options.changed(urls, error, suggested); }
  };
  const refresh = () => pending = pending.catch(() => {}).then(async () => {
    if (closed) return;
    const advertised = typeof options.advertised === "function" ? options.advertised() : options.advertised;
    const wantsPort80 = options.port !== 80 && advertised.some(value => { try { const url = new URL(value); return url.protocol === "http:" && !url.port; } catch { return false; } });
    try {
      const next = selectedNetwork();
      const moved = JSON.stringify(next) !== JSON.stringify(network);
      if ((active || port80) && (!enabled || moved)) await stopAll();
      if (closed) return;
      network = next;
      if (enabled && !active) {
        try { active = await options.start(next, options.port); }
        catch { throw new Error(`Couch cannot listen on ${next.address}:${options.port}. Another process may be using the port.`); }
      }
      // Port 80 is a best-effort extra listener: platforms that refuse the bind
      // keep the direct port and drop only the bare-name aliases.
      if (enabled && wantsPort80 && !port80) { try { port80 = await options.start(next, 80); } catch { port80 = null; } }
      if (!wantsPort80 && port80) { await port80.stop(); port80 = null; }
      if (moved) changed([`https://${next.address}:${options.port}`], null);
      const { urls, error } = await lanUrls(next, options.port, advertised, options.resolve, !!port80);
      const candidates = options.suggested?.() ?? [];
      const defaults = candidates.length ? await lanUrls(next, options.port, candidates, options.resolve) : null;
      // An unavailable automatic name is normal: keep the IP without a setup warning.
      const suggested = defaults?.urls.find(url => candidates.some(candidate => secureOrigin(candidate, options.port) === url)) ?? "";
      if (!closed) changed([...new Set([...suggested ? [suggested] : [], ...urls])], error, suggested);
    } catch (error) {
      await stopAll().catch(() => {});
      network = null;
      const message = error instanceof Error ? error.message : "Couldn't refresh the LAN address.";
      if (!closed) changed([], message);
      throw error;
    }
  });
  // DHCP can arrive after Core starts. Check the selected interface promptly,
  // without repeating alias DNS or queuing refreshes behind a slow lookup.
  let polling = false;
  const poll = () => {
    if (closed || polling) return;
    polling = true;
    void refresh().catch(() => {}).finally(() => { polling = false; });
  };
  const interfaceTimer = setInterval(() => {
    let next: LanNetwork | null = null;
    try { next = selectedNetwork(); } catch {}
    if (JSON.stringify(next) !== JSON.stringify(network) || (enabled && next && !active)) poll();
  }, 1_000);
  interfaceTimer.unref();
  const timer = setInterval(poll, 60_000);
  timer.unref();
  poll();
  return {
    get server() { return active; },
    get servers() { return [active, port80].filter((server): server is T => server !== null); },
    get network() { return network; },
    refresh,
    validateAlias: (value: string) => pending = pending.catch(() => {}).then(async () => {
      if (enabled && (!active || !network)) throw new Error("The LAN listener is unavailable.");
      const selected = enabled ? network! : selectLan((options.interfaces ?? networkInterfaces)(), options.selected, options.address);
      const result = await lanUrls(selected, options.port, [value], options.resolve, true);
      if (!result.urls.includes(secureOrigin(value, options.port))) throw new Error(result.error ?? "The network address is unavailable.");
      if (options.port !== 80 && !new URL(value).port && !port80) {
        try {
          const listener = await options.start(selected, 80);
          if (enabled) port80 = listener;
          else await listener.stop();
        }
        catch { throw new Error("Couch can't use port 80. Add Couch's port to the address."); }
      }
    }),
    async setEnabled(value: boolean) {
      enabled = value;
      if (!value) await (pending = pending.catch(() => {}).then(stopAll));
      if (value) {
        try { await refresh(); }
        catch (error) { enabled = false; throw error; }
      }
    },
    async close() { closed = true; clearInterval(timer); clearInterval(interfaceTimer); await pending.catch(() => {}); await stopAll(); },
  };
}
