/** Run with Bun, open the printed loopback URL, then click Run in an audible browser. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Identity } from "@sonn-audio/node-sendspin";
import { createSendspin } from "../../src/server/sendspin";
import type { PlaybackTarget, PlayerState } from "../../src/shared/protocol";
const directory = join(process.cwd(), ".artifacts/sendspin-host", new Date().toISOString().replaceAll(":", "-"));
await mkdir(directory, { recursive: true });
const bundle = await Bun.build({ entrypoints: [fileURLToPath(import.meta.resolve("@sendspin/sendspin-js"))], target: "browser", minify: false });
if (!bundle.success) throw new Error("Could not bundle the official Sendspin client.");
const keys = new Map<string, string>(); let target: PlaybackTarget, player: PlayerState;
const host = createSendspin({ host: "127.0.0.1", port: 0, name: "Software qualification" }, { identity: Identity.generate().privateB64u, lookupPsk: id => keys.get(id) ?? null, changed: value => { target = value; }, observe: value => { player = value; } });
const wav = Buffer.alloc(44 + 60 * 192000); wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let sample = 0; sample < 60 * 48000; sample++) { const value = Math.round(12000 * Math.sin(2 * Math.PI * (sample < 30 * 48000 ? 440 : 880) * sample / 48000)); wav.writeInt16LE(value, 44 + sample * 4); wav.writeInt16LE(value, 46 + sample * 4); }
const page = `<!doctype html><meta charset="utf-8"><title>Sendspin software qualification</title><button id="run" disabled>Run two-output qualification</button><pre id="result">Preparing official SDK…</pre><script type="module">
import {SendspinPlayer,loadSendspinClientIdentity} from '/sdk.js';
const events=[],samples=[],analysers=[],contexts=[];window.proof={events,samples,contexts};
const OriginalContext=window.AudioContext;window.AudioContext=new Proxy(OriginalContext,{construct(T,args){const context=new T(...args);contexts.push(context);return context}});
const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(destination,...args){const result=connect.call(this,destination,...args);if(destination instanceof AudioDestinationNode){const analyser=this.context.createAnalyser();analyser.fftSize=4096;connect.call(this,analyser);analysers.push(analyser)}return result};
const sample=()=>analysers.map(analyser=>{const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);let squares=0,crossings=0;for(let i=0;i<data.length;i++){squares+=data[i]*data[i];if(i&&data[i-1]<=0&&data[i]>0)crossings++}return {rms:Math.sqrt(squares/data.length),frequency:crossings/data.length*analyser.context.sampleRate,context:analyser.context.state}});
setInterval(()=>{samples.push({time:performance.now(),outputs:sample()});if(samples.length>20000)samples.shift()},10);
const api=async(path,body)=>{const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!response.ok)throw Error(await response.text());return response.json()};
const until=async(test,label)=>{const end=performance.now()+15000;while(!await test()){if(performance.now()>end)throw Error(label);await new Promise(r=>setTimeout(r,25))}};
const players=[];for(let i=0;i<2;i++){const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};const identity=loadSendspinClientIdentity(storage);const credentials=await api('/enroll',{clientId:identity.clientId});players.push(new SendspinPlayer({storage,baseUrl:credentials.url,clientName:'Software output '+i,suite:'aesgcm',codecs:['pcm'],unpairedAccess:false,longTermPsks:[credentials],syncDelay:0,requiredLeadTimeMs:250,minBufferMs:250,reconnect:{maxAttempts:0}}))}
window.proof.players=players;document.querySelector('#run').disabled=false;
const outputs=(hz)=>{const values=sample();return values.length===2&&values.every(v=>hz?v.rms>0.001&&Math.abs(v.frequency-hz)<50:v.rms<0.0001)};
const record=async(event)=>{const row={event,time:performance.now(),outputs:sample(),status:await api('/status')};events.push(row);document.querySelector('#result').textContent=JSON.stringify(row,null,2)};
document.querySelector('#run').onclick=()=>{const unlocked=players.map(p=>p.unlock());document.querySelector('#run').disabled=true;(async()=>{try{await Promise.all(unlocked);await Promise.all(players.map(p=>p.connect()));await until(async()=>((await api('/status')).target.members??[]).filter(m=>m.connected).length===2,'both clients connected');await api('/members',{});await api('/command',{type:'load',playbackId:'proof',source:location.origin+'/tone.wav',duration:60});await until(()=>outputs(440),'two audible440Hz outputs');await record('both440');await new Promise(r=>setTimeout(r,15000));await record('sustained15seconds');await api('/command',{type:'pause',playbackId:'proof',paused:true});await until(async()=>outputs(0)&&(await api('/status')).player.status==='paused','pause silence');await record('pausedSilent');await api('/command',{type:'seek',playbackId:'proof',position:30});await api('/command',{type:'speed',playbackId:'proof',speed:1.25});await until(async()=>{const s=(await api('/status')).player;return s.position===30&&s.speed===1.25},'paused seek/speed');await api('/command',{type:'pause',playbackId:'proof',paused:false});await until(()=>outputs(880),'two sought880Hz outputs');await record('both880At1.25');const stopAt=performance.now();await api('/command',{type:'stop'});await until(async()=>outputs(0)&&(await api('/status')).player.status==='idle','stop silence');await record('stoppedSilent');await api('/receipt',{pass:true,events,samples,userAgent:navigator.userAgent,stopElapsedMs:performance.now()-stopAt,scope:'Two actual official JS Web Audio graphs; no physical speaker measurement'});document.querySelector('#result').textContent+='\\nPASS; receipt saved';}catch(error){await api('/receipt',{pass:false,error:String(error),events,samples,userAgent:navigator.userAgent});document.querySelector('#result').textContent=String(error)}})()};
</script>`;
const http = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/") return new Response(page, { headers: { "Content-Type": "text/html" } });
    if (url.pathname === "/sdk.js") return new Response(bundle.outputs[0], { headers: { "Content-Type": "text/javascript" } });
    if (url.pathname === "/tone.wav") return new Response(wav, { headers: { "Content-Type": "audio/wav" } });
    if (url.pathname === "/status") return Response.json({ target, player, perf: { cpu: process.cpuUsage(), rss: process.memoryUsage().rss, wall: performance.now() } });
    if (request.method !== "POST") return new Response(null, { status: 405 });
    // This fixture never listens off loopback and accepts requests only from its own page.
    if (request.headers.get("origin") !== url.origin) return new Response(null, { status: 403 });
    if (url.pathname === "/enroll") { const { clientId } = await request.json(); if (!/^[\w-]{43}$/.test(clientId) || keys.size >= 2) return new Response(null, { status: 400 }); const psk = randomBytes(32).toString("base64url"); keys.set(clientId, psk); return Response.json({ psk, serverId: host.serverId, url: `http://127.0.0.1:${host.port}` }); }
    if (url.pathname === "/members") { await host.setMembers([...keys.keys()]); return Response.json({ ok: true }); }
    if (url.pathname === "/command") { host.send(await request.json()); return Response.json({ ok: true }); }
    if (url.pathname === "/receipt") { const receipt = await request.json(); await Bun.write(join(directory, "results.json"), JSON.stringify(receipt, null, 2)); console.log(`Qualification ${receipt.pass ? "PASS" : "FAIL"}: ${directory}/results.json`); return Response.json({ ok: true }); }
    return new Response(null, { status: 404 });
  } catch (error) { return new Response(String(error), { status: 400 }); }
} });
console.log(`Open ${http.url} and click Run. Receipts: ${directory}`);
process.once("SIGINT", () => { void host.close().finally(() => http.stop(true)); });
