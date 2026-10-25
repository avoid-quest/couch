import { serverNowUs } from '@sonn-audio/node-sendspin';

export type LivePcmEvent = { type:'reset' } | { type:'error'; error:string } | { type:'chunk'; wire:'pcm'; at:number; duration:number; data:Buffer };

/** Send available normalized samples immediately; partial final packets never wait for another capture block. */
export function createLivePcm(emit: (event: LivePcmEvent) => void, failed: (error: string) => void) {
  let closed=false, error:string|undefined, epoch=0, draining=false, scheduled=false, queuedFrames=0, lateUs=0;
  let pending:{epoch:number; reset:boolean; at:number; pcm:Float32Array; offset:number}[]=[];
  const fail=(reason:unknown)=>{
    if(closed||error)return;
    error=reason instanceof Error?reason.message:'PCM capture failed.';
    pending=[];queuedFrames=0;epoch++;
    failed(error);
  };
  const drain=()=>{
    if(draining||closed||error)return;
    draining=true;let consumed=0;
    try{
      while(pending.length&&!closed&&!error){
        const block=pending[0]!;
        if(block.reset){block.reset=false;emit({type:'reset'});}
        if(block.epoch!==epoch)continue;
        while(block.offset<block.pcm.length/2&&!closed&&!error&&block.epoch===epoch){
          const frames=Math.min(240,block.pcm.length/2-block.offset);
          const at=Math.round(block.at+block.offset/48000*1e6),duration=frames/48000*1e6;
          const data=Buffer.allocUnsafe(frames*4);
          for(let i=0;i<frames*2;i++)data.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(block.pcm[block.offset*2+i]!*32768))),i*2);
          block.offset+=frames;queuedFrames-=frames;consumed+=frames;
          if(at<=serverNowUs()){
            lateUs+=duration;
            if(lateUs>=500000)throw new Error('PCM capture missed half a second of deadlines. Start sharing again.');
          }else{lateUs=0;emit({type:'chunk',wire:'pcm',at,duration,data});}
          if(consumed>=4096&&pending.length){
            if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;drain();});}
            return;
          }
        }
        if(block.epoch===epoch)pending.shift();
      }
    }catch(reason){fail(reason);}finally{draining=false;}
  };
  return {
    write(normalized: { reset: boolean; atUs: number; pcm: Float32Array }){
      if(closed||error)return false;
      try{
        if(normalized.reset){epoch++;pending=[];queuedFrames=lateUs=0;}
        queuedFrames+=normalized.pcm.length/2;
        if(queuedFrames>96000)throw new Error('PCM capture exceeded its bounded queue.');
        pending.push({epoch,reset:normalized.reset,at:normalized.atUs,pcm:normalized.pcm,offset:0});
        drain();return !closed&&!error;
      }catch(reason){fail(reason);return false;}
    },
    error:()=>error,
    close(){if(closed)return;closed=true;epoch++;pending=[];queuedFrames=0;},
  };
}
