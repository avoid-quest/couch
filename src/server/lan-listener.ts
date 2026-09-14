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
export function selectLan(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>, selected?: string): LanNetwork {
  const networks = Object.entries(interfaces).flatMap(([name, entries]) => (entries ?? []).filter(entry => entry.family === "IPv4" && !entry.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address) && (selected ? name === selected : !/^(docker|br-|veth|virbr|tun|tap|utun)/.test(name))).map(entry => ({ name, address: entry.address, netmask: entry.netmask })));
  if (networks.length === 0) throw new Error("No eligible LAN address. Connect to a private IPv4 LAN before enabling remote control.");
  if (networks.length !== 1) throw new Error("Several LAN networks are available. Select one with COUCH_LAN_INTERFACE and restart Couch.");
  return networks[0]!;
}
export async function lanUrls(network: LanNetwork, port: number, advertised: string[], resolve = lookup) {
  const ip = `http://${network.address}:${port}`;
  for (const value of advertised) {
    const url = new URL(value);
    if (url.protocol !== "http:" || Number(url.port || 80) !== port || url.pathname !== "/" || url.username || url.password || url.search || url.hash) throw new Error("Custom LAN names must use HTTP and Couch's port, without a proxy or path.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const answers = await Promise.race([
      resolve(url.hostname, { all: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("LAN DNS lookup timed out. Check the configured name.")), 5_000); }),
    ]).finally(() => clearTimeout(timer));
    if (!answers.length || answers.some(answer => answer.address !== network.address)) throw new Error("The custom LAN name does not resolve only to this Couch address. Fix LAN DNS or remove COUCH_ADVERTISE_URLS.");
  }
  return [...new Set([...advertised, ip])];
}

export function createLanListener<T extends { stop(close: boolean): Promise<void> }>(options: {
  port: number; enabled: boolean; selected?: string; advertised: string[];
  start: (network: LanNetwork) => T;
  changed: (urls: string[], error: string | null) => void;
  interfaces?: typeof networkInterfaces;
}) {
  let enabled = options.enabled, closed = false, active: T | null = null, network: LanNetwork | null = null;
  let pending: Promise<void> = Promise.resolve();
  let last = "";
  const refresh = () => pending = pending.catch(() => {}).then(async () => {
    if (closed) return;
    try {
      const next = selectLan((options.interfaces ?? networkInterfaces)(), options.selected);
      const urls = await lanUrls(next, options.port, options.advertised);
      if (closed) return;
      if (active && (!enabled || JSON.stringify(next) !== JSON.stringify(network))) { await active.stop(true); active = null; }
      network = next;
      if (enabled && !active) {
        try { active = options.start(next); }
        catch { throw new Error(`Couch cannot listen on ${next.address}:${options.port}. Another process may be using the port.`); }
      }
      const state = JSON.stringify(urls);
      if (last !== state) { last = state; options.changed(urls, null); }
    } catch (error) {
      if (active) await active.stop(true);
      active = null; network = null;
      const message = error instanceof Error ? error.message : "Could not refresh the LAN address.";
      if (last !== message) { last = message; options.changed([], message); }
      throw error;
    }
  });
  const timer = setInterval(() => { void refresh().catch(() => {}); }, 10_000);
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
