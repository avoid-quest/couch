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
  if (networks.length === 0) throw new Error(selected || address ? "No eligible LAN address matches COUCH_LAN_INTERFACE/COUCH_LAN_ADDRESS. Check that the selected private IPv4 address is assigned locally." : "No eligible LAN address. Connect to a private IPv4 LAN before enabling remote control.");
  if (networks.length !== 1) throw new Error("Several LAN addresses are available. Select a network with COUCH_LAN_INTERFACE; if it has multiple addresses, also set COUCH_LAN_ADDRESS to one of its private IPv4 addresses and restart Couch.");
  return networks[0]!;
}
export async function lanUrls(network: LanNetwork, port: number, advertised: string[], resolve = lookup) {
  const ip = `http://${network.address}:${port}`;
  const results = await Promise.all(advertised.map(async (value, index) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" || Number(url.port || 80) !== port || url.pathname !== "/" || url.username || url.password || url.search || url.hash || /[\s\\]/.test(value)) throw new Error("Use HTTP and Couch's port, without credentials, a proxy or a path.");
      const answers = await Promise.race([
        resolve(url.hostname, { all: true }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("LAN DNS lookup timed out.")), 5_000); }),
      ]);
      if (!answers.length || answers.some(answer => answer.address !== network.address)) throw new Error("The name does not resolve only to the selected Couch address.");
      return { url: url.origin };
    } catch (error) {
      return { error: `Custom LAN address ${index + 1} was ignored: ${error instanceof Error ? error.message : "DNS lookup failed."}` };
    } finally { clearTimeout(timer); }
  }));
  const errors = results.flatMap(result => result.error ? [result.error] : []);
  return { urls: [...new Set([...results.flatMap(result => result.url ? [result.url] : []), ip])], error: errors.length ? `${errors.join(" ")} Direct IP access remains available. Check COUCH_ADVERTISE_URLS and LAN DNS.` : null };
}

export function createLanListener<T extends { stop(close: boolean): Promise<void> }>(options: {
  port: number; enabled: boolean; selected?: string; address?: string; advertised: string[];
  start: (network: LanNetwork) => T;
  changed: (urls: string[], error: string | null) => void;
  interfaces?: typeof networkInterfaces;
  resolve?: typeof lookup;
}) {
  let enabled = options.enabled, closed = false, active: T | null = null, network: LanNetwork | null = null;
  let pending: Promise<void> = Promise.resolve();
  let last = "";
  const changed = (urls: string[], error: string | null) => {
    const state = JSON.stringify([urls, error]);
    if (last !== state) { last = state; options.changed(urls, error); }
  };
  const refresh = () => pending = pending.catch(() => {}).then(async () => {
    if (closed) return;
    try {
      const next = selectLan((options.interfaces ?? networkInterfaces)(), options.selected, options.address);
      const moved = JSON.stringify(next) !== JSON.stringify(network);
      if (active && (!enabled || moved)) { await active.stop(true); active = null; }
      if (closed) return;
      network = next;
      if (enabled && !active) {
        try { active = options.start(next); }
        catch { throw new Error(`Couch cannot listen on ${next.address}:${options.port}. Another process may be using the port.`); }
      }
      if (moved) changed([`http://${next.address}:${options.port}`], null);
      const { urls, error } = await lanUrls(next, options.port, options.advertised, options.resolve);
      if (!closed) changed(urls, error);
    } catch (error) {
      if (active) await active.stop(true);
      active = null; network = null;
      const message = error instanceof Error ? error.message : "Could not refresh the LAN address.";
      if (!closed) changed([], message);
      throw error;
    }
  });
  const timer = setInterval(() => { void refresh().catch(() => {}); }, 60_000);
  timer.unref();
  void refresh().catch(() => {});
  return {
    get server() { return active; },
    get network() { return network; },
    refresh,
    async setEnabled(value: boolean) {
      enabled = value;
      if (!value && active) { await active.stop(true); active = null; }
      if (value) {
        try { await refresh(); }
        catch (error) { enabled = false; throw error; }
      }
    },
    async close() { closed = true; clearInterval(timer); await pending.catch(() => {}); await active?.stop(true); active = null; },
  };
}
