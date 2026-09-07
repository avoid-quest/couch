import { execFile } from "node:child_process";
import type { ControllerIdentity } from "../shared/controllers";
import type { StartupState } from "../shared/startup";
import { ControllerError, settingField } from "./controllers";
import tauriConfig from "../../src-tauri/tauri.conf.json";

const help = "From SSH, run sudo lightdm --show-config and inspect sudo journalctl -u 'couch-autostart@*'. Repair the couch-appliance installation or conflicting LightDM overrides, then refresh.";
const command = (file: string, args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile(file, args, { env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LC_ALL: "C" }, encoding: "utf8", timeout: 5_000, maxBuffer: 128 * 1024, killSignal: "SIGKILL" }, (error, stdout, stderr) => error ? reject(new Error(`The TV startup operation failed. ${help}`)) : resolve(stdout + stderr));
});

// LightDM prints its merged configuration on stderr, with source IDs before keys.
// Seat:* applies first, then matching seat sections in their printed order.
export function startupEnabled(configuration: string): boolean {
  const groups = new Map<string, Record<string, string>>();
  let current: Record<string, string> | undefined;
  for (const line of configuration.split("\n")) {
    if (line === "Sources:") break;
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (section) { current = {}; groups.set(section[1]!, current); continue; }
    const entry = /^(?:[A-Z]|\d+)?\s+([\w-]+)=(.*)$/.exec(line);
    if (entry && current) current[entry[1]!] = entry[2]!.trim();
  }
  if (!groups.size) throw new Error(`LightDM returned no readable startup configuration. ${help}`);
  const seat = { ...groups.get("Seat:*") };
  for (const [name, values] of groups) {
    if (!name.startsWith("Seat:") || name === "Seat:*") continue;
    const pattern = name.slice(5).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    if (new RegExp(`^${pattern}$`).test("seat0")) Object.assign(seat, values);
  }
  const user = seat["autologin-user"] || "";
  if (groups.get("LightDM")?.["start-default-seat"] === "false") throw new Error(`LightDM is configured not to start the TV seat. ${help}`);
  if (!user && seat["autologin-guest"] !== "true") return false;
  if (user !== "couch-tv" || (seat["autologin-session"] || seat["user-session"]) !== "couch" || seat["autologin-in-background"] === "true" || seat["autologin-guest"] === "true") throw new Error(`LightDM has a conflicting TV startup configuration. ${help}`);
  return true;
}

export function startupBootReady(service: string, target: string, manager: string) {
  // Ubuntu's display-manager alias makes LightDM "indirect", not "enabled".
  return service.split("\n").includes("LoadState=loaded") && /^(?:UnitFileState=)(?:enabled|indirect)$/m.test(service) && target.trim() === "graphical.target" && manager.trim() === "lightdm.service";
}

type Backend = { read: () => Promise<boolean>; write: (enabled: boolean) => Promise<void>; fullscreen: () => Promise<boolean | null> };
export function createStartup(fullscreen: Backend["fullscreen"], backend?: Backend) {
  const os = backend ?? {
    read: async () => {
      const [configuration, service, target, manager] = await Promise.all([
        command("/usr/sbin/lightdm", ["--show-config"]),
        command("/usr/bin/systemctl", ["show", "lightdm.service", "--property=LoadState,UnitFileState"]),
        command("/usr/bin/systemctl", ["get-default"]),
        command("/usr/bin/systemctl", ["show", "display-manager.service", "--property=Id", "--value"]),
      ]);
      if (!startupBootReady(service, target, manager)) throw new Error("Ubuntu is not configured to boot into LightDM. From SSH, inspect systemctl status lightdm.service and systemctl get-default; repair the couch-appliance installation, then refresh.");
      return startupEnabled(configuration);
    },
    write: async (enabled: boolean) => { await command("/usr/bin/systemctl", ["--no-ask-password", "start", `couch-autostart@${enabled ? "enable" : "disable"}.service`]); },
    fullscreen,
  };
  let pending = false;
  return {
    async handle(request: Request, identity: () => ControllerIdentity | null) {
      const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
      const authorize = () => { if (identity()?.authority !== "administrator") throw new ControllerError("An administrator remote is required.", 403); };
      try {
        authorize();
        if (request.method !== "GET" && request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
        let enabled: boolean;
        if (request.method === "POST") {
          const requested = await settingField(request, "enabled");
          if (typeof requested !== "boolean") throw new ControllerError("Send enabled as true or false.", 400);
          authorize();
          if (pending) throw new ControllerError("Another startup change is still being applied. Refresh before trying again.", 409);
          pending = true;
          try {
            await os.write(requested);
            enabled = await os.read();
            if (enabled !== requested) throw new Error(`The saved change is overridden by another LightDM setting. ${help}`);
          } finally { pending = false; }
        } else enabled = await os.read();
        const fullscreenNow = await os.fullscreen().catch(() => null);
        authorize();
        return json({ enabled, fullscreenAtLaunch: tauriConfig.app.windows[0]!.fullscreen, fullscreenNow, applies: "next-session" } satisfies StartupState);
      } catch (error) { return json({ error: error instanceof Error ? error.message : `TV startup is unavailable. ${help}` }, error instanceof ControllerError ? error.status : 503); }
    },
  };
}
