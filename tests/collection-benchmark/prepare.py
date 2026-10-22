from pathlib import Path
import base64,struct,zlib
repo=Path.cwd()
scratch=repo/'build/couch-review-render'
scratch.mkdir(parents=True,exist_ok=True)
def chunk(t,data): return struct.pack('>I',len(data))+t+data+struct.pack('>I',zlib.crc32(t+data))
raw=b''.join(b'\0'+bytes(sum(([int(40+160*x/255),int(30+80*y/255),int(130-80*x/255)] for x in range(256)),[])) for y in range(256))
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',256,256,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(raw))+chunk(b'IEND',b'')
b64=base64.b64encode(png).decode()
s=(repo/'tests/ui-audit.browser.tsx').read_text().replace('"../src/','"../../src/')
s='import { Profiler } from "react";\n'+s
def replace(old,new):
 global s
 if old not in s: raise SystemExit('UI audit fixture changed; update the collection benchmark: '+old)
 s=s.replace(old,new)
replace('const thumbnail = "https://i.ytimg.com/vi/vWLJeqLPfSU/hqdefault.jpg";',f'const thumbnail = URL.createObjectURL(new Blob([Uint8Array.from(atob("{b64}"), c=>c.charCodeAt(0))],{{type:"image/png"}}));')
replace('thumbnail:"https://i.ytimg.com/vi/ferZnZ0_rSM/hqdefault.jpg"','thumbnail')
replace('window.fetch = async (input, init) => {','const expand = (item:any, count:number) => Array.from({length:count}, (_,i)=>({...item,id:i ? item.id+"-"+i : item.id,mediaId:i ? "audit-history-"+i : item.mediaId, title:i ? item.title+" "+i : item.title,url:i ? item.url+"&review="+i : item.url}));\n  window.fetch = async (input, init) => {')
replace("[saved]};", "expand(saved, (window as any).reviewCount??40)};")
replace("[history]};", "expand(history, (window as any).reviewCount??40)};")
replace('body = {items:items.map', 'body = {items:expand(items[0], (window as any).reviewCount??40).map')
replace('const render=()=>root.render(<SessionGateContext', 'const render=()=>root.render(<Profiler id="app" onRender={(_id,phase,duration)=>{ const list=(window as any).reviewProfiles; if(list)list.push({phase,duration,at:performance.now()}); }}><SessionGateContext')
replace('</SessionGateContext>);','</SessionGateContext></Profiler>);')
replace('    client,router,calls,','''    pulse() { gate={...gate,state:{...gate.state,devices:gate.state!.devices.map(d=>({...d})),queue:gate.state!.queue.map(e=>({...e})),player:{...gate.state!.player}}}; render(); },
    snapshot() { return gate.state; },
    client,router,calls,''')
(scratch/'audit.tsx').write_text(s)
html='''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Couch render audit</title></head><body><div id="fixture"></div><script type="module" src="./main.ts"></script></body></html>'''
html=html.replace('<html>','<html lang="en" class="dark">').replace('<script type="module" src="./main.ts"></script>','<script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true; await import("./main.ts");</script>')
(scratch/'index.html').write_text(html)
(scratch/'prod.html').write_text('<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Couch render audit production</title></head><body><div id="fixture"></div><script type="module" src="./main.ts"></script></body></html>')
(scratch/'styles.css').write_text('@import "../../src/client/index.css";\n@source "../../src/client";\n')
(scratch/'main.ts').write_text('''import "./styles.css";
import { mountUiAudit } from "./audit";
window.reviewProfiles=[];
window.review=await mountUiAudit();
window.reviewReady=true;
''')
print(scratch/'index.html')
