/** Actual SDK/CLI software-output qualification. Requires Docker and the documented pinned image. */
import { mkdir, chmod, realpath } from "node:fs/promises";
import { join } from "node:path";
import { createSendspin } from "../../src/server/sendspin";
import type { PlaybackTarget, PlayerState } from "../../src/shared/protocol";
const root = await realpath(process.cwd());
const directory = process.env.COUCH_SENDSPIN_ARTIFACTS ?? join(root, ".artifacts/sendspin", new Date().toISOString().replaceAll(":", "-"));
await mkdir(directory, { recursive: true });
const container = `couch-sendspin-${process.pid}`;
const image = process.env.COUCH_SENDSPIN_IMAGE ?? "couch-sendspin-qualification:9.1.1";
const run = (...cmd: string[]) => { const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" }); if (result.exitCode) throw new Error(new TextDecoder().decode(result.stderr)); return new TextDecoder().decode(result.stdout).trim(); };
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const events: unknown[] = [];
const record = (event: string, details: unknown = {}) => { const row = { event, time: Date.now(), details }; events.push(row); console.log(JSON.stringify(row)); };
async function until(test: () => boolean | Promise<boolean>, label: string, timeout = 20000) { const end = Date.now() + timeout; while (!await test()) { if (Date.now() > end) throw new Error(`Timed out: ${label}`); await Bun.sleep(50); } }
const wav = Buffer.alloc(44 + 60 * 192000);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let sample = 0; sample < 60 * 48000; sample++) { const value = Math.round(12000 * Math.sin(2 * Math.PI * (sample < 30 * 48000 ? 440 : 880) * sample / 48000)); wav.writeInt16LE(value, 44 + sample * 4); wav.writeInt16LE(value, 46 + sample * 4); }
const http = Bun.serve({ port: 0, fetch(request) { const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get("range") ?? ""); if (!range) return new Response(wav, { headers: { "Content-Type": "audio/wav", "Accept-Ranges": "bytes" } }); const start = Number(range[1]), end = range[2] ? Number(range[2]) : wav.length - 1; return new Response(wav.subarray(start, end + 1), { status: 206, headers: { "Content-Type": "audio/wav", "Content-Range": `bytes ${start}-${end}/${wav.length}`, "Accept-Ranges": "bytes" } }); } });
let adapter: ReturnType<typeof createSendspin> | undefined, target: PlaybackTarget | undefined, player: PlayerState | undefined;
const states: unknown[] = [];
const callbacks = { changed(value: PlaybackTarget) { target = structuredClone(value); states.push({ time: Date.now(), target }); }, observe(value: PlayerState) { player = value; } };
try {
  run("docker", "run", "--rm", "-d", "--name", container, "-v", `${root}:${root}`, "-w", root, image, "sleep", "infinity");
  run("docker", "exec", container, "sh", "-c", "pulseaudio --daemonize=yes --exit-idle-time=-1; pactl load-module module-null-sink sink_name=room1 rate=48000 channels=2; pactl load-module module-null-sink sink_name=room2 rate=48000 channels=2");
  const wrapper = join(directory, "python");
  await Bun.write(wrapper, `#!/bin/sh\nexec docker exec -i ${container} python "$@"\n`); await chmod(wrapper, 0o755);
  const config = { python: wrapper, script: join(root, "src/server/sendspin-server.py"), stateDirectory: join(directory, "trust"), name: "Couch integration", port: 8991, ffmpeg: Bun.which("ffmpeg")! };
  adapter = createSendspin(config, callbacks);
  await until(() => player?.status === "idle", "helper start");
  for (const number of [1, 2]) {
    const room = `room${number}`;
    const command = ["sendspin", "daemon", "--url", "ws://127.0.0.1:8991/sendspin", "--name", room, "--settings-dir", join(directory, room), "--port", String(8991 + number), "--audio-device", "pulse", "--audio-format", "pcm:48000:16:2", "--hardware-volume", "false", "--disable-mpris"];
    run("docker", "exec", "-d", "-e", `PULSE_SINK=${room}`, container, "sh", "-c", `echo $$ > ${quote(join(directory, room + ".client.pid"))}; exec ${command.map(quote).join(" ")} > ${quote(join(directory, room + ".log"))} 2>&1`);
    run("docker", "exec", "-d", container, "sh", "-c", `echo $$ > ${quote(join(directory, room + ".pid"))}; exec parec --latency-msec=10 --process-time-msec=10 --device=${room}.monitor --format=s16le --rate=48000 --channels=2 > ${quote(join(directory, room + ".pcm"))}`);
  }
  await until(() => target?.members?.length === 2, "two real clients");
  const ids = target!.members!.map(member => member.id);
  async function pairingPin(member: { id: string; name: string }) {
    const path = join(directory, member.name + ".log");
    const before = [...(await Bun.file(path).text()).matchAll(/enter PIN (\d+)/g)].length;
    await adapter!.pair(member.id);
    let pin: string | undefined;
    await until(async () => { const matches = [...(await Bun.file(path).text()).matchAll(/enter PIN (\d+)/g)]; if (matches.length > before) pin = matches.at(-1)?.[1]; return !!pin; }, "pairing PIN");
    return pin!;
  }
  const firstMember = target!.members![0]!;
  const originalPin = await pairingPin(firstMember);
  await adapter.pair(firstMember.id, originalPin === "000000" ? "111111" : "000000");
  await until(() => (target as any)?.pairing?.stage === "error", "wrong PIN rejected"); record("wrong_pin_rejected");
  for (const member of target!.members!) {
    const pin = await pairingPin(member);
    await adapter.pair(member.id, pin);
    await until(() => (target?.members?.find(m => m.id === member.id) as any)?.paired, "pairing completion");
  }
  record("paired_two_actual_clients");
  await adapter.setMembers(ids); await until(() => !!target?.connected, "joined group");
  await adapter.close(); player = undefined;
  adapter = createSendspin({ ...config, qualifiedClientIds: ids }, callbacks);
  await until(() => !!target?.connected && player?.status === "idle", "durable trust and membership after helper restart");
  record("trust_restart_idle", { handoffSafety: target?.handoffSafety });
  function tail(room: string) { const file = Bun.file(join(directory, room + ".pcm")); return file.slice(Math.max(0, file.size - 19200)).arrayBuffer().then(bytes => { const pcm = new Int16Array(bytes); let squares = 0, crossings = 0; for (let i = 0; i < pcm.length; i += 2) { squares += pcm[i]! ** 2; if (i > 0 && pcm[i - 2]! <= 0 && pcm[i]! > 0) crossings++; } return { rms: Math.sqrt(squares / (pcm.length / 2)), frequency: crossings / (pcm.length / 2 / 48000) }; }); }
  const both = async (frequency: number) => (await Promise.all([tail("room1"), tail("room2")])).every(value => frequency ? value.rms > 100 && Math.abs(value.frequency - frequency) < 40 : value.rms < 20);
  adapter.send({ type: "load", playbackId: "tone", source: `http://127.0.0.1:${http.port}/tone.wav`, duration: 60 } as any);
  await until(() => both(440), "both 440Hz"); record("both_play_440");
  adapter.send({ type: "pause", playbackId: "tone", paused: true });
  await until(async () => player?.status === "paused" && await both(0), "pause and actual silence"); record("paused_silent", { position: player?.position });
  adapter.send({ type: "seek", playbackId: "tone", position: 30 });
  await until(() => player?.status === "paused" && player.position === 30, "paused seek");
  adapter.send({ type: "pause", playbackId: "tone", paused: false });
  await until(() => both(880), "both 880Hz after seek"); record("both_seek_880");
  await adapter.setMemberVolume(ids[0]!, 70, false); await until(() => target?.members?.find(m => m.id === ids[0])?.volume === 70, "observed member volume");
  await adapter.setMembers([ids[0]!]); await until(async () => (await tail(target!.members!.find(m => m.id === ids[1])!.name)).rms < 20, "removed member silence"); record("member_removed_silent");
  await adapter.setMembers(ids); await until(() => both(880), "late join output"); record("member_rejoined");
  adapter.send({ type: "stop" }); await until(async () => player?.status === "idle" && await both(0), "stop actual silence"); record("stopped_silent");
  await adapter.reconnect(); await until(() => !!target?.connected && player?.status === "idle", "explicit reconnect no autoplay"); record("reconnected_idle");
  adapter.send({ type: "load", playbackId: "loss", source: `http://127.0.0.1:${http.port}/tone.wav`, duration: 60 } as any);
  await until(() => both(440), "play before backend loss");
  run("docker", "exec", container, "python", "-c", `import os,pathlib,signal; needle=${JSON.stringify(config.script)}.encode(); [os.kill(int(p.parent.name),signal.SIGKILL) for p in pathlib.Path('/proc').glob('[0-9]*/cmdline') if needle in p.read_bytes().split(b'\\0')]`);
  await until(() => !target?.connected && player?.status === "unavailable", "backend loss invalidates target"); record("backend_loss_unavailable");
  await adapter.reconnect(); await until(() => !!target?.connected && player?.status === "idle", "recover backend without autoplay"); record("backend_recovered_idle");
  const revoked = target!.members!.find(member => member.id === ids[0])!;
  await adapter.unpair(revoked.id);
  await until(() => !(target?.members?.find(member => member.id === revoked.id) as any)?.paired, "trust revocation"); record("trust_revoked");
  await until(() => !!target?.members?.find(member => member.id === revoked.id)?.connected, "revoked client reconnect");
  await adapter.pair(revoked.id, await pairingPin(revoked));
  await until(() => (target?.members?.find(member => member.id === revoked.id) as any)?.paired, "re-pair revoked client");
  await adapter.setMembers(ids); record("revoked_client_repaired");
  const sourceHashes = Object.fromEntries(await Promise.all(["src/server/sendspin.ts", "src/server/sendspin-server.py", "src/server/pcm-decoder.ts", "tests/linux/sendspin.ts"].map(async path => [path, new Bun.CryptoHasher("sha256").update(await Bun.file(join(root, path)).arrayBuffer()).digest("hex")])));
  const versions = run("docker", "exec", container, "python", "-c", "import importlib.metadata as m,json; print(json.dumps({name:m.version(name) for name in ['aiosendspin','sendspin','av']}))");
  await Bun.write(join(directory, "results.json"), JSON.stringify({ pass: true, sourceHashes, versions: JSON.parse(versions), events, states, scope: "Actual SDK and CLI with Pulse software sinks; no physical audible-sync claim." }, null, 2));
} catch (error) {
  await Bun.write(join(directory, "failure.json"), JSON.stringify({ error: String(error), target, player, events, states }, null, 2)); throw error;
} finally {
  await adapter?.close(); await http.stop(true);
  try { run("docker", "rm", "-f", container); } catch {}
}
