import { resolve } from 'node:path';
const base = resolve(import.meta.dir);
const source = process.argv[2] || `${base}/package.original.yml`;
const original = Bun.YAML.parse(await Bun.file(source).text()) as any;
const cases = [
  {name:'defaults',inputs:{},want:['draft','candidate','upload'],build:true,qualify:true},
  {name:'preview-publish',inputs:{publish:true},want:['draft','candidate','upload','publish','readiness'],build:true,qualify:true},
  {name:'stable-retained',inputs:{channel:'stable','build-run':123,'artifact-kind':'hosted-ready',publish:true},qualified:true,want:['draft','candidate','upload','publish','readiness'],build:false,qualify:false},
  {name:'retry-unqualified',inputs:{'build-run':123},want:['draft','candidate','upload'],build:false,qualify:true},
  {name:'readiness-retained',inputs:{'build-run':123,'readiness-only':true},qualified:true,want:['draft','candidate','readiness'],build:false,qualify:false},
  {name:'reject-stable-build',inputs:{channel:'stable'},want:[],exit:1},
  {name:'reject-readiness-build',inputs:{'readiness-only':true},want:[],exit:1},
  {name:'branch-guard',inputs:{},ref:'refs/heads/feature',want:[],build:false,qualify:false},
  {name:'disabled-guard',inputs:{},enabled:false,want:[],build:false,qualify:false},
  {name:'qualification-fails',inputs:{publish:true},failQualification:true,want:['draft'],exit:1,build:true,qualify:true},
] as any[];
const results=[];
for (const test of cases) {
  const workflow=structuredClone(original);
  workflow.name=`Acceptance277Act-${test.name}`;
  const trace= `printf '%s\\n' `;
  for (const [jobId,job] of Object.entries(workflow.jobs) as any[]) {
    delete job.environment;
    job.steps=job.steps.map((step:any,index:number)=>{
      const marker=`STEP:${jobId}:${index}:${step.name||step.uses}`;
      const replacement:any={name:step.name||step.uses,run:`${trace}${JSON.stringify(marker)}`};
      for(const key of ['if','id','env','continue-on-error'])if(key in step)replacement[key]=step[key];
      if(step.id==='draft')replacement.run+='\necho "release-id=local-mock-release" >> "$GITHUB_OUTPUT"';
      if(step.name==='Check the candidate inputs') {
        // Execute the exact source-build input assertions; retained cryptographic/provenance checks are mocked.
        replacement.run+='\nif [ "$BUILD_RUN" = 0 ]; then\n'+step.run.slice(step.run.lastIndexOf('test "$CHANNEL"'));
      }
      if(step.id==='qualification') {
        replacement.run+='\nmkdir -p .artifacts/hosted-release';
        replacement.run+=`\nprintf '{"version":"fixture","revision":"b38b01f","files":[]}' > .artifacts/hosted-release/manifest.json`;
        if(test.qualified) replacement.run+=`\nprintf '{"version":"fixture","revision":"b38b01f","files":[],"checks":["signatures","typecheck","bun","native","signed-manifest-extraction","installer"]}' > .artifacts/hosted-release/qualified.json`;
        else replacement.run+='\nrm -f .artifacts/hosted-release/qualified.json';
        // Run the real receipt predicate with jq. Keep git provenance transport inert.
        replacement.run+='\ngit() { printf "MOCK git %s\\n" "$*"; }\n'+step.run;
      }
      if(step.name==='Qualify the exact signed bytes'&&test.failQualification)replacement.run+='\nexit 17';
      return replacement;
    });
    job.steps.push({name:'Record completed job',run:`echo JOB_OK:${jobId}`});
  }
  const workflowFile=`${base}/workspace/${test.name}.yml`;
  const eventFile=`${base}/workspace/${test.name}.json`;
  await Bun.write(workflowFile,Bun.YAML.stringify(workflow));
  await Bun.write(eventFile,JSON.stringify({ref:test.ref||'refs/heads/main',repository:{full_name:'avoid-quest/couch',default_branch:'main'},inputs:Object.fromEntries(Object.entries({notes:'Disposable local validation',...test.inputs}).map(([k,v])=>[k,String(v)]))}));
  const args=[`${base}/bin/act`,'workflow_dispatch','-C',`${base}/workspace`,'-W',workflowFile,'-e',eventFile,'--env-file','/dev/null','--secret-file','/dev/null','--var-file','/dev/null','--input-file','/dev/null','--platform','blacksmith-4vcpu-ubuntu-2404=couch-local-systemd-arm64-5832:latest','--container-architecture','linux/arm64','--pull=false','--network','none','--container-daemon-socket','-','--no-cache-server','--rm','--concurrent-jobs','1','--var',`COUCH_RELEASES_ENABLED=${test.enabled===false?'false':'true'}`,'--action-cache-path',`${base}/action-cache`,'--log-prefix-job-id'];
  const start=performance.now();
  const p=Bun.spawn(args,{env:{PATH:process.env.PATH!,HOME:`${base}/home`,DOCKER_HOST:'unix:///Users/devit/.docker/run/docker.sock'},stdout:'pipe',stderr:'pipe'});
  const [out,err,exit]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
  const log=out+err;
  await Bun.write(`${base}/logs/${test.name}.log`,log);
  const jobs=[...log.matchAll(/\| JOB_OK:(\w+)/g)].map(m=>m[1]);
  const build=log.includes('| STEP:candidate:7:Build and sign');
  const qualify=log.includes('| STEP:candidate:9:Qualify the exact signed bytes');
  const pass=JSON.stringify(jobs)===JSON.stringify(test.want)&&exit===(test.exit||0)&&(test.build===undefined||build===test.build)&&(test.qualify===undefined||qualify===test.qualify);
  const result={name:test.name,pass,exit,expectedExit:test.exit||0,jobs,expectedJobs:test.want,build,qualify,seconds:Number(((performance.now()-start)/1000).toFixed(3)),command:args};
  results.push(result);console.log(JSON.stringify(result));
}
await Bun.write(`${base}/results.json`,JSON.stringify({source,sourceSHA256:new Bun.CryptoHasher('sha256').update(await Bun.file(source).arrayBuffer()).digest('hex'),cases:results},null,2));
if(results.some(x=>!x.pass))process.exitCode=1;
