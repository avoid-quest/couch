// Production route tree with deterministic read responses for visual state review.
// No API writes or playback commands leave this fixture.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { routeTree } from "../src/client/routeTree.gen";
import { SessionGateContext } from "../src/client/session/gate-context";
import type { SessionGateValue } from "../src/client/session/session-context";
import { deviceId } from "../src/client/session/device-id";
import { isTvPresentation } from "../src/client/session/presentation";
import { avoidRadioPlaylistId } from "../src/shared/radio";
import type { Action } from "../src/shared/protocol";

const wait = (ms = 160) => new Promise(resolve => setTimeout(resolve, ms));
const thumbnail = "https://i.ytimg.com/vi/vWLJeqLPfSU/hqdefault.jpg";
const creator = {title:"NPR Music",url:"https://www.youtube.com/@nprmusic"};
const collection = {title:"Tiny Desk concerts",url:"https://www.youtube.com/playlist?list=PL1B627337ED6F55F0",index:0};
const entry = {id:"concert",title:"Khruangbin: Tiny Desk Concert",source:"web:https://www.youtube.com/watch?v=vWLJeqLPfSU",thumbnail,subtitle:"NPR Music",duration:900,creator,collection};
const station = {id:"audit-radio",name:"NTS Radio",url:"https://stream.example.com/nts",homepage:"https://www.nts.live",countryCode:"GB",codec:"MP3",bitrate:128,sourceId:avoidRadioPlaylistId,logoUrl:thumbnail};
const media = {id:entry.id,provider:"youtube",kind:"media",url:entry.source.slice(4),title:entry.title,thumbnail,subtitle:entry.subtitle,creator,collection,duration:900,description:"Khruangbin perform a live set at NPR Music.\n\nExplore the channel or the full Tiny Desk collection."};
const saved = {...media,kind:"web",source:entry.source,sourceLabel:"YouTube",savedAt:Date.now()};
const history = {...media,mediaId:"audit-history",sourceLabel:"YouTube",position:120,watched:false,playable:true,queueEntryId:entry.id};
export type AuditMode = "loaded" | "loading" | "empty" | "error";
export async function mountUiAudit() {
  const wasTv = document.body.classList.contains('tv-presentation');
  document.body.classList.toggle('tv-presentation', isTvPresentation());
  const root = createRoot(document.getElementById("fixture")!);
  const originalFetch = window.fetch;
  const client = new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false,staleTime:30_000}}});
  const id = deviceId();
  let mode: AuditMode = "loaded";
  const unknown = new Set<string>();
  const calls: string[] = [];
  const actions: Action[] = [];
  window.fetch = async (input, init) => {
    const url = new URL(String(input), location.href), path = url.pathname;
    if (!path.startsWith("/api/")) return originalFetch(input,init);
    calls.push(path + url.search);
    if (init?.method && init.method !== "GET") return Response.json({});
    if (mode === "loading") await new Promise((_, reject) => { if(init?.signal?.aborted) reject(init.signal.reason); else init?.signal?.addEventListener("abort",()=>reject(init.signal!.reason),{once:true}); });
    if (mode === "error") return Response.json({error:"This source is temporarily unavailable. Try again."},{status:503});
    const items = mode === "empty" ? [] : [media,{...media,id:"second",title:"Anderson .Paak & The Free Nationals: Tiny Desk Concert",url:"https://www.youtube.com/watch?v=ferZnZ0_rSM",thumbnail:"https://i.ytimg.com/vi/ferZnZ0_rSM/hqdefault.jpg",collection:{...collection,index:1}}];
    let body: unknown;
    if (/\/providers\/[^/]+\/items$/.test(path)) {
      const provider = path.split('/')[3]!;
      const target = url.searchParams.get('url') ?? '';
      const single = target.includes('watch') || target.includes('track');
      const title = target.includes('@') ? 'NPR Music' : target ? 'Tiny Desk concerts' : undefined;
      body = {items:items.map(item=>({...item,provider,kind:provider==='twitch'?'media':item.kind,live:provider==='twitch',url:provider==='twitch'?'https://www.twitch.tv/nprmusic':item.url})),...(target?{item:{...media,provider,url:target,kind:single?'media':'collection',title:single?media.title:title},title:single?media.title:title,thumbnail,description:media.description}: {})};
    } else if(path==='/api/providers/favorites') body={favorites:mode==='empty'?[]:[{...media,kind:'channel',url:creator.url,title:creator.title}]};
    else if(path==='/api/updates/targets') body=[];
    else if(path==='/api/updates/helpers') body={status:'idle',checkedAt:null,items:[]};
    else if(path==='/api/devices') body={devices:[{id:deviceId(),name:'Studio browser',role:'administrator',createdAt:Date.now(),lastSeenAt:Date.now()},{id:'audit-tv',name:'Living room TV',role:'controller',createdAt:Date.now(),lastSeenAt:Date.now()}]};
    else if(path.endsWith('/pairing-code')||path.endsWith('/claim-code')) body={code:'123456'};
    else if(path==='/api/for-later') body={items:mode==='empty'?[]:[saved]};
    else if(path==='/api/progress/history') body={items:mode==='empty'?[]:[history]};
    else if(path.startsWith('/api/progress/')) body={item:history};
    else if(path==='/api/playlists') body={playlists:mode==='empty'?[]:[{id:'audit-list',name:'Sunday listening',entryCount:2,duration:1800,updatedAt:Date.now()}]};
    else if(path.startsWith('/api/playlists/')) body={playlist:{id:'audit-list',name:'Sunday listening',entries:[entry,{...entry,id:'next',title:'The next concert'}]}};
    else if(path==='/api/radio/avoid') body={playlist:{id:avoidRadioPlaylistId,name:'avoid radio',stationCount:1,error:null},stations:mode==='empty'?[]:[station]};
    else if(path==='/api/radio/avoid/programmes') body={programmes:mode==='empty'?{}:{[station.id]:{stationId:station.id,title:'Early Bird',artworkUrl:thumbnail,description:'Music for the beginning of the day.',expiresAt:Date.now()+3600000}}};
    else if(path==='/api/radio/favorites') body={favorites:mode==='empty'?[]:[station]};
    else if(path.startsWith('/api/radio/stations/')) body={station};
    else if(path==='/api/radio/stations') body={stations:mode==='empty'?[]:[station]};
    else if(path==='/api/radio/playlists') body={playlists:[]};
    else if(path==='/api/radio/sources') body={sources:[]};
    else if(path==='/api/iptv/sources') body={sources:mode==='empty'?[]:[{id:'guide',name:'Public television',channelCount:1,url:'https://example.com/live.m3u',updatedAt:Date.now()}]};
    else if(path==='/api/iptv/guide') body={channels:mode==='empty'?[]:[{id:'channel',name:'Arts live',group:'Culture',url:'https://example.com/live.m3u8',now:{title:'Live performance',start:Date.now()-600000,stop:Date.now()+1800000}}],total:mode==='empty'?0:1,groups:['Culture']};
    else if(path.endsWith('/logo')) return new Response(null,{status:404});
    else {unknown.add(path); return Response.json({error:'Not available in this browser review.'},{status:503});}
    return Response.json(body);
  };
  const baseState = {
    installationName:'Living room',playback:'p',controlling:id,currentEntryId:null,queue:[entry,{...entry,id:'next',title:'The next concert'}],
    player:{status:'idle',playbackId:'p',speed:1,volume:50,position:120,duration:900,seekable:true,tracks:[],error:null},
    devices:[{id,name:'Studio browser',role:'administrator',online:true,volume:50,muted:false,sharing:{audio:true,video:true}},{id:'audit-tv',name:'Living room TV',tv:true,online:true,volume:60,muted:false,sharing:{audio:true,video:true}}],
    outputs:[{deviceId:id,picture:false,sound:true}],playbacks:[{id:'p',title:entry.title,status:'paused',audioOnly:true,outputs:[{deviceId:id,picture:false,sound:true}]}],
    liveSources:[],preferences:{profile:{audioLanguage:'',subtitleLanguage:'',subtitles:'auto',speed:1,autoplay:true},device:{audioDelay:0}},activeProfile:{id:'default',name:'Everyone'},profiles:[{id:'default',name:'Everyone'}],autoplay:{enabled:true,contextTitle:null,upcoming:[]},versions:{},administratorClaimed:true,
  };
  let gate = {credentials:{origin:location.origin,token:'visual-fixture',installationId:'visual-fixture'},connected:true,status:'connected',nativeHost:false,localHost:false,tvPresentation:isTvPresentation(),queryClient:client,
    identity:{authority:'administrator',device:{id,name:'Studio browser',role:'administrator'}},details:{name:'Living room',installationId:'visual-fixture',urls:[location.origin],systemAudio:false,tvPresentation:false},
    videoQualityPreference:{quality:'auto',setQuality:()=>{}},screenWakeLock:{enabled:false,setEnabled:()=>{}},run:async(action:Action)=>{actions.push(action);return true;},queue:async(_title:string,work:()=>Promise<unknown>)=>work(),setError:()=>{},seekBy:async()=>true,offerUndo:()=>{},unpair:()=>{},setCredentials:()=>{},remoteControlEnabled:true,booting:false,error:null,
    state:baseState,
  } as unknown as SessionGateValue;
  const router = createRouter({routeTree,history:createMemoryHistory({initialEntries:['/']}),context:{queryClient:client,identity:gate.identity,localHost:false,connected:true}});
  const render=()=>root.render(<SessionGateContext value={gate}><QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider></SessionGateContext>);
  render();await wait(300);
  return {
    async go(href:string, options:{mode?:AuditMode;player?:string;video?:boolean;live?:boolean;connected?:boolean;fresh?:boolean;retry?:boolean;controller?:boolean;buffering?:boolean;pairing?:'new'|'removed'|'starting'|'failed';remote?:'ready'|'offline'|'private'|'none'}={}) {
      const nextMode=options.mode??'loaded';
      if (options.fresh) { await router.navigate({href:href==='/'?'/saved':'/'}); await wait(); }
      if(nextMode!==mode||options.fresh){mode=nextMode;client.clear();}
      const current=options.player ? {...entry,...options.live?{source:`radio:${station.id}`,kind:'radio',live:true,title:station.name,creator:undefined,collection:undefined,subtitle:undefined}: {}}:entry;
      gate={...gate,localHost:options.pairing==='starting'||options.pairing==='failed',booting:options.pairing==='starting',pairingRequired:!!options.pairing,pairingOrigin:location.origin,linkedPairingCode:'',savePairing:()=>{},retryHost:()=>{},credentials:options.pairing==='new'?null:{origin:location.origin,token:'visual-fixture',installationId:'visual-fixture'},connected:options.connected??true,identity:{...gate.identity!,authority:options.controller?'controller':'administrator'},state:{...baseState,controlling:options.remote?'audit-tv':id,devices:options.remote==='none'?[baseState.devices[0]!]:baseState.devices.map(device=>device.id==='audit-tv'?{...device,online:options.remote!=='offline',sharing:{audio:options.remote!=='private',video:options.remote!=='private'}}:device),currentEntryId:options.player?entry.id:null,queue:mode==='empty'?[]:[current,{...entry,id:'next',title:'The next concert'}],radioRetry:options.retry?{retryAt:Date.now()+10000,attempt:2,maximum:5}:undefined,
        player:{...baseState.player,status:options.player??'idle',buffering:options.buffering,error:options.player==='error'?'The source stopped responding. Try again or play the next item.':null},
        outputs:[{deviceId:id,picture:options.video??false,sound:true}],playbacks:[{...baseState.playbacks[0],audioOnly:!options.video}],
      }} as SessionGateValue;
      render();await router.navigate({href});await wait(options.mode==='loading'?100:350);
      return {href:router.state.location.href,title:document.title,loading:document.querySelectorAll('[data-loading]').length,overflow:document.documentElement.scrollWidth>innerWidth,errors:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent),unknown:[...unknown]};
    },
    async click(label:string) {const target=[...document.querySelectorAll<HTMLElement>('button,a')].find(e=>e.checkVisibility()&&(e.getAttribute('aria-label')===label||e.textContent===label)); if(!target) throw new Error(`No visible control: ${label}`);target.click();await wait();},
    setReadMode(value: AuditMode) { mode=value; },
    // A remote/OS Stop changes session state without navigating this browser.
    async stopPlayback() {
      gate={...gate,state:{...gate.state!,currentEntryId:null,player:{...gate.state!.player,status:'idle'}}};
      render();await wait();
    },
    async resumePlayback() {
      gate={...gate,state:{...gate.state!,currentEntryId:entry.id,player:{...gate.state!.player,status:'paused'}}};
      render();await wait();
    },
    async updateSession(update: (current: SessionGateValue) => SessionGateValue) { gate=update(gate);render();await wait(); },
    client,router,calls,actions,
    close(){root.unmount();client.clear();window.fetch=originalFetch;document.body.classList.toggle('tv-presentation',wasTv);},
  };
}


export async function runUiStabilityRegression() {
  const audit=await mountUiAudit();
  const assert=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
  const frames: number[]=[];
  let frame=0;
  const sample=()=>{frames.push(document.querySelectorAll('[data-loading]').length);frame=requestAnimationFrame(sample);};
  try {
    await audit.go('/saved',{fresh:true});
    await audit.go('/item?kind=saved&id=concert');
    assert(document.querySelector('h1')?.textContent===media.title,'Saved detail did not use known metadata');
    assert(!document.querySelector('[data-loading="details"]'),'Cached saved item flashed a detail skeleton');
    const href='/collection?provider=youtube&url='+encodeURIComponent(collection.url);
    await audit.go(href,{fresh:true});
    await audit.go('/saved');
    sample();
    await audit.go(href);
    cancelAnimationFrame(frame);
    assert(frames.every(count=>count===0),'Warm navigation painted loading placeholders');
    const title=document.querySelector('h1')!;
    const top=title.getBoundingClientRect().top;
    audit.setReadMode('loading');
    void audit.client.invalidateQueries({queryKey:['search','provider-page']});
    await wait();
    assert(document.querySelector('h1')===title,'Background refresh remounted the title');
    assert(!document.querySelector('[data-loading]'),'Background refresh replaced cached content');
    assert(title.getBoundingClientRect().top===top,'Background refresh moved the heading');
    await audit.client.cancelQueries();
    audit.setReadMode('error');
    await audit.client.invalidateQueries({queryKey:['search','provider-page']});
    await wait();
    assert(document.querySelector('h1')?.textContent==='Tiny Desk concerts','Failed refresh discarded usable cached content');
    await audit.go('/saved',{mode:'loading',fresh:true});
    assert(document.querySelector('[data-loading="rows"]'),'Cold list lacks a skeleton');
    assert(!document.querySelector('[data-loading] button,[data-loading] a'),'Skeleton took a focus stop');
    return {passed:true,checks:['saved detail seeded from list cache','warm navigation has no skeleton frame','refresh retains mounted content and heading position','failed refresh retains content','cold skeleton has no interactive targets']};
  } finally {cancelAnimationFrame(frame);audit.close();}
}
