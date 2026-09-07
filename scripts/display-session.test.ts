import { expect, test } from "bun:test";
import { mkdtemp, writeFile, chmod, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("the actual appliance session retains the panel and does not change primary output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "couch-display-session-"));
  try {
    for (const [name, body] of Object.entries({
      id: "echo couch-tv",
      systemctl: "echo active",
      "dbus-update-activation-environment": "exit 0",
      xset: "exit 0",
      openbox: "exit 0",
      xrandr: 'if [ "$1" = --query ]; then printf "eDP-1 connected primary 1366x768+0+0\\nHDMI-1 connected 1920x1080+1366+0\\n"; else printf "%s\\n" "$*" >> "$COUCH_DISPLAY_TEST_LOG"; fi',
    })) {
      const path = join(directory, name);
      await writeFile(path, `#!/bin/bash\n${body}\n`);
      await chmod(path, 0o700);
    }
    const log = join(directory, "commands");
    const process = Bun.spawn(["/bin/bash", resolve("packaging/appliance/root/usr/lib/couch-appliance/session")], { env: { ...Bun.env, PATH: `${directory}:/usr/bin:/bin`, COUCH_DISPLAY_TEST_LOG: log }, stdout: "ignore", stderr: "pipe" });
    expect(await process.exited).toBe(0);
    const commands = await readFile(log, "utf8");
    expect(commands).toContain("--output HDMI-1 --mode 1920x1080");
    expect(commands).toContain("--output eDP-1 --auto --left-of HDMI-1");
    expect(commands).not.toContain("--off");
    expect(commands).not.toContain("--primary");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
