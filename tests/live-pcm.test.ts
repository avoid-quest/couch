import {expect,test,mock} from 'bun:test';
let now=10_000_000;
mock.module('@sonn-audio/node-sendspin',()=>({serverNowUs:()=>now}));
const {createLivePcm}=await import('../src/server/live-pcm');
const {createCaptureClock}=await import('../src/server/capture-audio');
const packet=(sequence=0,position=0,frames=1024,generation='one',rate=48000)=>({generation,sequence,samplePosition:position,capturedAtUs:Math.round(9_980_000+position/rate*1e6),sampleRate:rate,channels:2 as const,pcm:Float32Array.from({length:frames*2},(_,i)=>.7*Math.sin((position*2+i)*.071))});
const fixture=()=>{now=10_000_000;const events:any[]=[],errors:string[]=[];const listeners=new Set<(event:any)=>void>(), clock=createCaptureClock({intent:'live',liveAudioLeadMs:45}), encoder=createLivePcm(event=>{events.push(event);for(const listen of listeners)listen(event);},e=>errors.push(e)), source={write:(input:any)=>encoder.error()?false:encoder.write(clock.push(input,now)),close:()=>encoder.close(),subscribe:(listen:any)=>listeners.add(listen)};return{source,events,errors,chunks:()=>events.filter(e=>e.type==='chunk')};};

test('normal1024 capture emits its partial tail immediately, preserving normalized PCM and exact source timeline',()=>{
  const f=fixture(),input=packet(),reference=createCaptureClock({intent:'live',liveAudioLeadMs:45}).push(input,now);
  expect(f.source.write(input)).toBe(true);const chunks=f.chunks();expect(chunks.map(x=>x.data.length/4)).toEqual([240,240,240,240,63]);
  expect(chunks[0].at).toBe(reference.atUs);expect(chunks.at(-1).at).toBe(reference.atUs+20000);
  const data=Buffer.concat(chunks.map(x=>x.data));expect(data.length).toBe(reference.pcm.length*2);
  for(let i=0;i<reference.pcm.length;i++)expect(data.readInt16LE(i*2)).toBe(Math.max(-32768,Math.min(32767,Math.round(reference.pcm[i]!*32768))));
  expect(f.errors).toEqual([]);f.source.close();
});
test('variable rates and block sizes retain every normalized frame, no framing pad or extra delay',async()=>{
  for(const rate of [44100,48000,96000]){
    const f=fixture(),clock=createCaptureClock({intent:'live',liveAudioLeadMs:45});let pos=0,index=0;const expected:Buffer[]=[];
    for(const frames of [128,256,1024,240,101,4096]){
      const input=packet(index++,pos,frames,'one',rate);now=input.capturedAtUs+20000;
      const ref=clock.push(input,now);const encoded=Buffer.alloc(ref.pcm.length*2);ref.pcm.forEach((x,i)=>encoded.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(x*32768))),i*2));expected.push(encoded);
      expect(f.source.write(input)).toBe(true);await Promise.resolve();pos+=frames;
    }
    expect(Buffer.concat(f.chunks().map(x=>x.data))).toEqual(Buffer.concat(expected));expect(f.errors).toEqual([]);f.source.close();
  }
});
test('late samples are not reanchored and still trigger the existing bounded failure policy',()=>{
  const f=fixture();now=11_000_000;
  for(let i=0;i<30&&!f.errors.length;i++)f.source.write(packet(i,i*1024));
  expect(f.chunks()).toHaveLength(0);expect(f.errors).toHaveLength(1);expect(f.errors[0]).toContain('deadlines');expect(f.source.write(packet(30,30*1024))).toBe(false);f.source.close();
});
test('close during reset emits no samples and close during a packet stops the remainder',()=>{
  for(const on of ['reset','chunk']){const f=fixture();f.source.subscribe(e=>{if(e.type===on)f.source.close();});f.source.write(packet());expect(f.chunks()).toHaveLength(on==='reset'?0:1);f.source.close();}
});
test('reentrant same-generation writes stay ordered; new generations retire the old remainder',async()=>{
  for(const reset of [false,true]){const f=fixture();let triggered=false;f.source.subscribe(e=>{if(e.type==='chunk'&&!triggered){triggered=true;f.source.write(packet(reset?0:1,reset?0:1024,256,reset?'two':'one'));}});f.source.write(packet());await Promise.resolve();const chunks=f.chunks();expect(f.errors).toEqual([]);expect(chunks.length).toBe(reset?3:7);expect(f.events.filter(e=>e.type==='reset').length).toBe(reset?2:1);if(!reset)expect(chunks.map(x=>x.at)).toEqual([...chunks.map(x=>x.at)].sort((a,b)=>a-b));f.source.close();}
});
