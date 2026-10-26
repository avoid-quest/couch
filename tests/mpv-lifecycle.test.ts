import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("mpv cancels pending loads on close or replacement and preserves selected channels and speed", () => {
  const result = spawnSync(process.execPath, ["-e", `
    import { mock, spyOn } from "bun:test";
    import assert from "node:assert/strict";
    import { EventEmitter } from "node:events";
    const pending=[], launches=[], reports=[];
    mock.module("./src/server/helpers.ts",()=>({helper:()=>new Promise(resolve=>pending.push(resolve))}));
    spyOn(await import("node:child_process"),"spawn").mockImplementation((path,args)=>{launches.push(args);return Object.assign(new EventEmitter(),{kill(){}})});
    spyOn(await import("node:net"),"connect").mockImplementation(()=>Object.assign(new EventEmitter(),{destroy(){},write(){}}));
    const {createMpv}=await import("./src/server/mpv.ts");
    const player=createMpv(state=>reports.push(state));
    const load={type:"load",playbackId:"same",source:"https://media.example/old"};
    const settle=()=>new Promise(setImmediate);
    player.send(load); player.close(); pending.shift()("mpv"); await settle();
    assert.equal(launches.length,0,"closed adapter started a stale process");
    player.send(load);
    player.send({...load,source:"https://media.example/new",output:{picture:false,sound:true},preferences:{speed:1.5},startPosition:20});
    pending.shift()("mpv"); await settle();
    assert.equal(launches.length,0,"replaced load started a stale process with reused identity");
    pending.shift()("mpv"); await settle();
    assert.equal(launches.length,1);
    assert.equal(launches[0].at(-1),"https://media.example/new");
    for(const arg of ["--vid=no","--force-window=no","--speed=1.5","--start=20"]) assert.ok(launches[0].includes(arg),arg);
    assert.equal(reports.at(-1).speed,1.5);
    player.send({...load,output:{picture:true,sound:false}});pending.shift()("mpv");await settle();
    assert.ok(launches[1].includes("--aid=no"));
    player.close();
  `], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});
