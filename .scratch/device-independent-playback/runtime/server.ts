import { createHub } from "../../../src/server/hub";
import { openStore } from "../../../src/server/store";
import type { PlayerState } from "../../../src/shared/protocol";
const db = `${import.meta.dir}/couch.sqlite`;
const store = openStore(db); store.saveRemoteControlEnabled(true); while(store.setupStep() !== "complete") store.advanceSetup(store.setupStep()); store.close();
const idle: PlayerState = { playbackId: null, status: "idle", position: 0, duration: null, volume: 68, seekable: false, error: null };
let observed = { ...idle };
const hub = createHub({ port: 4117, databasePath: db, development: true, hostToken: "local-browser-handoff-fixture-host", pairingCode: "123456", observePlayer: () => queueMicrotask(() => hub.session.observe(observed)), sendPlayer(command) {
  console.log(JSON.stringify({ nativeCommand: command.type, playbackId: "playbackId" in command ? command.playbackId : undefined }));
  if (command.type === "load") observed = { ...idle, volume: observed.volume, playbackId: command.playbackId, status: command.paused ? "paused" : "playing", position: command.startPosition ?? 0, speed: command.preferences?.speed ?? 1, duration: command.radio ? null : 90, seekable: !command.radio, tracks: [{id:"native-audio", index:1, kind:"audio", label:"Default audio",language:"",selected:true}, ...(!command.radio ? [{id:"native-video",index:0,kind:"video" as const,label:"Video",language:"",selected:true}] : [])] };
  else if (command.type === "stop") observed = { ...idle, volume: observed.volume };
  else if (command.type === "pause") observed = { ...observed, status: command.paused ? "paused" : "playing" };
  else if (command.type === "seek") observed = { ...observed, position: command.position };
  else if (command.type === "volume") observed = { ...observed, volume: command.volume };
  else if (command.type === "speed") observed = { ...observed, speed: command.speed };
  else return;
  queueMicrotask(() => hub.session.observe(observed));
} });
hub.session.observe(idle);
setInterval(() => { if (observed.status === "playing") { observed = { ...observed, position: observed.position + (observed.speed ?? 1) }; hub.session.observe(observed); } }, 1000);
const fixture = Bun.serve({ port: 4118, fetch(request) {
  if (new URL(request.url).pathname === "/radio.m3u") return new Response("#EXTM3U\n#EXTINF:-1,FIP\nhttps://icecast.radiofrance.fr/fip-midfi.mp3\n");
  const file = Bun.file(`${import.meta.dir}/seekable.mp4`);
  const match = request.headers.get("range")?.match(/bytes=(\d+)-(\d*)/);
  const start = match ? Number(match[1]) : 0, end = match?.[2] ? Number(match[2]) : file.size - 1;
  return new Response(file.slice(start, end + 1), { status: match ? 206 : 200, headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1), ...(match ? { "Content-Range": `bytes ${start}-${end}/${file.size}` } : {}) } });
} });
console.log(`READY ${hub.origin} fixture=${fixture.url}`);
