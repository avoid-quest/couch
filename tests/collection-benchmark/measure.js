window.measureRender = async function({ms=6000,pulseHz=0,scroll=false,hover=false,frames=false}={}) {
 const start=performance.now(), profiles=window.reviewProfiles.length;
 let changes=0,levelChanges=0, frame=0,last=0,updates=0;
 const deltas=[],tasks=[];
 const observer=new MutationObserver(records=>{changes+=records.length;levelChanges+=records.filter(r=>r.target.parentElement?.matches('.level')).length});
 observer.observe(document.getElementById('fixture'),{subtree:true,childList:true,attributes:true,attributeFilter:['style','class'],characterData:true});
 const po=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({duration:e.duration,startTime:e.startTime}))));
 po.observe({type:'longtask',buffered:false});
 const interval=pulseHz?setInterval(()=>{window.review.pulse();updates++},1000/pulseHz):0;
 const animate=t=>{if(last)deltas.push(t-last);last=t;if(scroll){let scroller=document.scrollingElement;let max=Math.min(3000,scroller.scrollHeight-innerHeight);scroller.scrollTop=max*(.5-.5*Math.cos((t-start)/1100));}if(hover){const items=[...document.querySelectorAll('[data-tile], [data-nav-row]')];const item=items[Math.floor((t-start)/150)%items.length];item?.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));}frame=requestAnimationFrame(animate)};
 if(frames||scroll||hover)frame=requestAnimationFrame(animate);
 await new Promise(r=>setTimeout(r,ms));
 clearInterval(interval);cancelAnimationFrame(frame);observer.disconnect();po.disconnect();
 const times=window.reviewProfiles.slice(profiles).map(p=>p.duration).sort((a,b)=>a-b),sorted=[...deltas].sort((a,b)=>a-b);
 const quantile=(a,q)=>a.length?a[Math.min(a.length-1,Math.floor(q*a.length))]:null;
 return {elapsed:performance.now()-start,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,domNodes:document.querySelectorAll('*').length,rows:document.querySelectorAll('[data-nav-row]').length,levels:document.querySelectorAll('[data-level="moving"]').length,updates,commits:times.length,renderTotalMs:times.reduce((a,b)=>a+b,0),renderP95Ms:quantile(times,.95),mutations:changes,levelMutations:levelChanges,frames:deltas.length,fps:deltas.length/(ms/1000),frameP50Ms:quantile(sorted,.5),frameP95Ms:quantile(sorted,.95),framesOver25ms:deltas.filter(t=>t>25).length,longTasks:tasks,overflow:document.documentElement.scrollWidth>innerWidth,barBlur:document.querySelector('[data-now-playing]')?getComputedStyle(document.querySelector('[data-now-playing]')).backdropFilter:null};
};
window.runCollectionRenderRegression=async function(){
 window.reviewCount=1000;
 await window.review.go('/collection?provider=youtube&url=https%3A%2F%2Fwww.youtube.com%2Fplaylist%3Flist%3DPL1B627337ED6F55F0',{player:'playing',live:true,fresh:true});
 await window.measureRender({ms:1000,pulseHz:2});
 const result=await window.measureRender({ms:4000,pulseHz:2,scroll:true});
 window.collectionRegressionResult=result;
 if(result.longTasks.length>=2||result.fps<55)throw new Error(`Collection snapshot render regression: ${result.longTasks.length} long tasks; ${result.fps.toFixed(1)} fps (expected <2 tasks and >=55 fps)`);
 return result;
};
