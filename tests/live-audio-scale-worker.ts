// Production browser in its own process, profile and network namespace.
import { app, BrowserWindow, session } from "electron";
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { createInterface } from "node:readline";
import { configureAudioBuffers } from "../app/audio";

const config = JSON.parse(readFileSync(process.argv.at(-1)!, "utf8"));
app.setPath("userData", config.profile);
if (process.env.COUCH_LAB_APP_AUDIO_DEFAULTS === "1") configureAudioBuffers(app.commandLine);
for (const flag of ["disable-background-timer-throttling", "disable-renderer-backgrounding", "use-fake-ui-for-media-stream"]) app.commandLine.appendSwitch(flag);
if (config.capture) {
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-file-for-fake-audio-capture", config.capture);
}
const reply = (value: unknown) => process.stdout.write(`COUCH_SCALE ${JSON.stringify(value)}\n`);
void app.whenReady().then(async () => {
  session.defaultSession.setCertificateVerifyProc(({ hostname, certificate }, callback) => {
    if (hostname !== config.certificatePin.hostname) return callback(-3);
    callback(new X509Certificate(certificate.data).fingerprint256 === config.certificatePin.fingerprint256 ? 0 : -2);
  });
  session.defaultSession.setPermissionRequestHandler((_contents, permission, allow) => allow(permission === "media"));
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === "media");
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, nodeIntegration: false, contextIsolation: true } });
  win.webContents.on("render-process-gone", (_event, details) => { console.error(details); app.exit(1); });
  win.webContents.on("unresponsive", () => { console.error("Renderer unresponsive"); app.exit(1); });
  // Install observation before application startup, without replacing transport or media.
  await win.loadURL("about:blank");
  win.webContents.debugger.attach("1.3");
  await win.webContents.debugger.sendCommand("Page.enable");
  await win.webContents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const config = ${JSON.stringify(config)};
    if (location.origin !== config.origin) return;
    localStorage.setItem('sendspin-identity-sk', config.key);
    localStorage.setItem('couch.remote-token', config.token);
    localStorage.setItem('couch.remote-installation-id', config.installationId);
    localStorage.setItem('couch.device-name', config.name);
    localStorage.setItem('couch.device-sharing', JSON.stringify({audio:true,video:false}));
    const events = [], sockets = [], peers = [], errors = [];
    let omitted = 0, longTaskMs = 0, longTasks = 0, maxLongTaskMs = 0;
    const record = (type, detail = {}) => {
      if (events.length < 10000) events.push({at:performance.timeOrigin+performance.now(),type,...detail}); else omitted++;
    };
    addEventListener('error', event => { if(errors.length<32) errors.push(event.message); });
    addEventListener('unhandledrejection', event => { if(errors.length<32) errors.push(String(event.reason)); });
    new PerformanceObserver(list => { for(const item of list.getEntries()) {longTasks++;longTaskMs+=item.duration;maxLongTaskMs=Math.max(maxLongTaskMs,item.duration);} }).observe({type:'longtask', buffered:true});
    const Socket = WebSocket;
    window.WebSocket = class extends Socket {
      constructor(...args) {
        super(...args);
        const index = sockets.length; sockets.push(this);
        const path = new URL(args[0], location.href).pathname;
        record('socket-created',{index,path});
        this.addEventListener('open',()=>record('socket-open',{index,path}));
        this.addEventListener('close',event=>record('socket-close',{index,path,code:event.code}));
        this.addEventListener('message',event=>{
          if(typeof event.data !== 'string') return;
          try {const message=JSON.parse(event.data);
            if(['state','livePeers','liveSignal','player'].includes(message.type)) record('message',{index,message:message.type,
              peers:message.peers?.length,description:message.signal?.description?.type,command:message.command?.type,
              playerStatus:message.state?.player?.status});
          } catch {}
        });
      }
    };
    const Peer = RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      constructor(...args) {super(...args);const index=peers.length;peers.push(this);record('peer-created',{index});
        for(const event of ['connectionstatechange','iceconnectionstatechange','track']) this.addEventListener(event,()=>record(event,{index,state:this.connectionState,ice:this.iceConnectionState}));
      }
    };
    for(const method of ['createOffer','createAnswer','setLocalDescription','setRemoteDescription']) {
      const original=Peer.prototype[method];
      window.RTCPeerConnection.prototype[method]=async function(...args){
        const index=peers.indexOf(this), start=performance.now();record(method+'-start',{index});
        try{return await original.apply(this,args);}finally{record(method+'-end',{index,durationMs:performance.now()-start});}
      };
    }
    window.__scaleSession = () => {
      const root=document.getElementById('root'), container=root?.[Object.keys(root).find(key=>key.startsWith('__reactContainer'))];
      const nodes=[container?.stateNode.current];
      while(nodes.length){const node=nodes.pop(),value=node?.memoizedProps?.value;
        if(value?.startLive&&value?.queryClient)return value;
        if(node?.child)nodes.push(node.child);if(node?.sibling)nodes.push(node.sibling);
      }
    };
    const control = () => sockets.findLast(socket=>new URL(socket.url).pathname==='/api/ws' && socket.readyState===1);
    window.__scale = {
      disconnect:()=>{const socket=control();if(!socket)throw Error('No control socket');record('fault');socket.close(4000,'scale benchmark');return {at:performance.timeOrigin+performance.now(),sockets:sockets.length,peers:peers.length};},
      snapshot:async()=>({at:performance.timeOrigin+performance.now(),connected:!!__scaleSession()?.connected,
        player:__scaleSession()?.state?.player, events:events.splice(0),omitted,errors,longTasks,longTaskMs,maxLongTaskMs,
        media:[...document.querySelectorAll('audio,video')].map(e=>({paused:e.paused,readyState:e.readyState,muted:e.muted,currentTime:e.currentTime})),
        sockets:sockets.map(s=>({path:new URL(s.url).pathname,readyState:s.readyState})),
        peers:await Promise.all(peers.map(async(peer,index)=>({index,state:peer.connectionState,
          senders:peer.connectionState==='closed'?[]:peer.getSenders().map(sender=>({kind:sender.track?.kind??null,encodings:sender.getParameters().encodings})),
          stats:peer.connectionState==='closed'?[]:[...(await peer.getStats()).values()].filter(s=>['inbound-rtp','outbound-rtp','media-source','candidate-pair'].includes(s.type))})))
      })
    };
  })();` });
  await win.loadURL(config.origin + "/settings/device/sharing");
  reply({ ready: true, versions: process.versions, audioBufferFrames: app.commandLine.getSwitchValue("audio-buffer-size") || null });
  createInterface({ input: process.stdin }).on("line", async line => {
    let request: { id: number; code?: string; close?: boolean; profile?: "start" | "stop" } | undefined;
    try {
      request = JSON.parse(line);
      if (request!.close) { win.destroy(); app.quit(); return; }
      if (request!.profile) {
        if (request!.profile === "start") { await win.webContents.debugger.sendCommand("Profiler.enable"); await win.webContents.debugger.sendCommand("Profiler.start"); reply({ id: request!.id, value: true }); }
        else reply({ id: request!.id, value: await win.webContents.debugger.sendCommand("Profiler.stop") });
      } else reply({ id: request!.id, value: await win.webContents.executeJavaScript(request!.code!, true) ?? null });
    } catch (error) { reply({ id: request?.id, error: String(error) }); }
  });
  process.stdin.on("end", () => app.quit());
}).catch(error => { console.error(error); app.exit(1); });
