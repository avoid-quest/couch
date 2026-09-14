import {resolve} from 'node:path';
const base=resolve(import.meta.dir);
const current=Bun.YAML.parse(await Bun.file('.github/workflows/package.yml').text()) as any;
const original=Bun.YAML.parse(await Bun.file(`${base}/package.original.yml`).text()) as any;
const results=[];
const checkNames=['signatures','typecheck','bun','native','signed-manifest-extraction','installer'];
const manifest={version:'2026.915.1',revision:'b38b01f5beb92c8f6e08ae0ffae70d715c41b18c',files:[{name:'fixture',sha256:'fixture'}]};
const receipt={...manifest,checks:checkNames};
const fakeBin=base+'/fake-bin';
await Bun.write(fakeBin+'/git','#!/bin/bash\nprintf "MOCK git %s\\n" "$*" >> "$TRACE"\n');
await Bun.write(fakeBin+'/docker',`#!/bin/bash
printf '%s\\n' "$*" >> "$TRACE"
if [ "$1" = container ]; then test "$NO_CONTAINER" != true; exit; fi
if [ "$1" = cp ]; then
 case "$2" in */.artifacts/hosted-release/.*|*/.artifacts/appimage-inventory.json) exit 1;; esac
 if [ "$FAIL_FIRST_CACHE" = true ] && [[ "$2" == */target/.* ]]; then exit 1; fi
fi
`);
await Bun.spawn(['chmod','+x',fakeBin+'/git',fakeBin+'/docker']).exited;
async function run(name:string,script:string,extra:any={}){
 const dir=base+'/shell/'+name;await Bun.write(dir+'/script.sh',script);await Bun.write(dir+'/trace','');await Bun.write(dir+'/output','');
 const env={PATH:fakeBin+':'+process.env.PATH,HOME:dir+'/home',TRACE:dir+'/trace',GITHUB_OUTPUT:dir+'/output',BUILD_RUN:'123',...extra};
 const p=Bun.spawn(['bash','-eo','pipefail','script.sh'],{cwd:dir,env,stdout:'pipe',stderr:'pipe'});
 const [stdout,stderr,exit]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
 const result={name,exit,stdout,stderr,trace:await Bun.file(dir+'/trace').text(),output:await Bun.file(dir+'/output').text()};
 return result;
}
for(const [name,value,expected] of [
 ['missing',undefined,true],['complete',receipt,false],['partial',{...receipt,checks:checkNames.slice(0,-1)},true],['wrong-revision',{...receipt,revision:'different'},true],['wrong-version',{...receipt,version:'different'},true],['wrong-files',{...receipt,files:[]},true],['malformed','not json',true]
] as any[]) {
 for(const [label,workflow] of [['original',original],['fixed',current]] as const){
  const caseName=`receipt-${label}-${name}`;const dir=base+'/shell/'+caseName+'/.artifacts/hosted-release';
  await Bun.write(dir+'/manifest.json',JSON.stringify(manifest));
  if(value!==undefined)await Bun.write(dir+'/qualified.json',typeof value==='string'?value:JSON.stringify(value));
  const r=await run(caseName,workflow.jobs.candidate.steps.find((s:any)=>s.id==='qualification').run);
  const expectedNeeded=label==='original'?name==='missing':expected;
  results.push({...r,pass:r.exit===0&&r.output===`needed=${expectedNeeded}\n`,desiredNeeded:expected,demonstratesOriginalFailure:label==='original'&&expected&&name!=='missing'});
 }
}
const oldRetain=original.jobs.candidate.steps.find((s:any)=>s.name==='Retain build bytes, receipts and caches').run;
const fixedRetain=current.jobs.candidate.steps.find((s:any)=>s.name==='Retain compiler and dependency caches after any build outcome').run;
const old=await run('original-missing-output',oldRetain);results.push({...old,pass:old.exit===1&&!old.trace.includes('/work/src-tauri/target'),demonstratesOriginalFailure:true});
for(const [name,env,count] of [['fixed-missing-output',{},4],['fixed-first-cache-fails',{FAIL_FIRST_CACHE:'true'},4],['fixed-no-container',{NO_CONTAINER:'true'},0]] as const){
 const r=await run(name,fixedRetain,env);const copies=r.trace.split('\n').filter(x=>x.startsWith('cp '));
 results.push({...r,pass:r.exit===0&&copies.length===count});
}
const stop=current.jobs.candidate.steps.find((s:any)=>s.name==='Stop the builder').run;
const noContainer=await run('fixed-stop-no-container',stop,{NO_CONTAINER:'true'});
results.push({...noContainer,pass:noContainer.exit===0&&!noContainer.trace.includes('stop couch-build')});
await Bun.write(base+'/shell-results.json',JSON.stringify(results,null,2));
for(const r of results) console.log(`${r.pass?'PASS':'FAIL'} ${r.name}`);
if(results.some(x=>!x.pass))process.exitCode=1;
