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

test.each([
  { name: "disabled TV", geometry: "", failMode: false, expected: "--output HDMI-2 --mode 1920x1080 --right-of eDP-1\n" },
  { name: "TV without 1080p", geometry: "", failMode: true, expected: "--output HDMI-2 --mode 1920x1080 --right-of eDP-1\n--output HDMI-2 --auto --right-of eDP-1\n" },
  { name: "already enabled TV", geometry: "1920x1080+1920+0", failMode: false, expected: "" },
])("the running appliance session handles $name after an internal-only boot", async ({ geometry, failMode, expected }) => {
  const directory = await mkdtemp(join(tmpdir(), "couch-display-hotplug-"));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const inventory = join(directory, "inventory"), log = join(directory, "commands"), started = join(directory, "started");
    await writeFile(inventory, "eDP-1 connected primary 1920x1080+0+0\nHDMI-2 disconnected\n");
    await writeFile(log, "");
    for (const [name, body] of Object.entries({
      id: "echo couch-tv",
      systemctl: 'if [ "$2" = start ]; then touch "$COUCH_DISPLAY_TEST_DIR/started"; fi; echo active',
      "dbus-update-activation-environment": "exit 0",
      xset: "exit 0",
      openbox: "exec /bin/sleep 30",
      timeout: 'shift; exec "$@"',
      xrandr: 'case "$1" in --query|--current) printf "%s\\n" "$1" >> "$COUCH_DISPLAY_TEST_DIR/queries"; cat "$COUCH_DISPLAY_TEST_DIR/inventory";; *) printf "%s\\n" "$*" >> "$COUCH_DISPLAY_TEST_DIR/commands"; if [ "$COUCH_DISPLAY_TEST_FAIL_MODE" = 1 ] && [ "$3" = --mode ]; then exit 1; fi;; esac',
    })) {
      const path = join(directory, name);
      await writeFile(path, `#!/bin/bash\n${body}\n`);
      await chmod(path, 0o700);
    }
    child = Bun.spawn(["/bin/bash", resolve("packaging/appliance/root/usr/lib/couch-appliance/session")], { env: { ...Bun.env, PATH: `${directory}:/usr/bin:/bin`, COUCH_DISPLAY_TEST_DIR: directory, COUCH_DISPLAY_TEST_FAIL_MODE: failMode ? "1" : "0" }, stdout: "ignore", stderr: "pipe" });
    for (let attempt = 0; attempt < 300 && !await Bun.file(started).exists(); attempt++) await Bun.sleep(25);
    expect(await Bun.file(started).exists()).toBe(true);
    expect(await readFile(log, "utf8")).toBe("");
    await writeFile(inventory, `eDP-1 connected primary 1920x1080+0+0\nHDMI-2 connected ${geometry}\n`);
    let commands = "";
    for (let attempt = 0; attempt < 100 && !commands; attempt++) { await Bun.sleep(100); commands = await readFile(log, "utf8"); }
    expect(commands).toBe(expected);
    expect(commands).not.toContain("--off");
    expect(commands).not.toContain("--primary");
    await Bun.sleep(2100);
    expect(await readFile(log, "utf8")).toBe(commands);
    const queries = (await readFile(join(directory, "queries"), "utf8")).trim().split("\n");
    expect(queries.filter(query => query === "--query")).toHaveLength(1);
    expect(queries.filter(query => query === "--current").length).toBeGreaterThanOrEqual(2);
  } finally {
    child?.kill();
    if (child) await child.exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
