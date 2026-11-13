import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("mpv cancels retired loads and preserves controls through cache stalls", () => {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
    import { mock, spyOn } from "bun:test";
    import assert from "node:assert/strict";
    import { EventEmitter } from "node:events";
    import { Duplex } from "node:stream";
    const pending=[], launches=[], reports=[], connections=[], commands=[], children=[], addresses=[];
    mock.module("./src/server/helpers.ts",()=>({helper:()=>new Promise(resolve=>pending.push(resolve))}));
    spyOn(await import("node:child_process"),"spawn").mockImplementation((path,args)=>{launches.push(args);const child=Object.assign(new EventEmitter(),{kill(){}});children.push(child);return child;});
    spyOn(await import("node:net"),"connect").mockImplementation((address)=>{
      addresses.push(address);
      const socket=new Duplex({read(){},write(chunk,encoding,callback){commands.push(JSON.parse(String(chunk)).command);callback();}});
      connections.push(socket);return socket;
    });
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
    assert.equal(launches[0].includes("https://media.example/new"),false);
    connections.at(-1).emit("connect");
    assert.deepEqual(commands.at(-1),["loadfile","https://media.example/new"]);
    for(const arg of ["--vid=no","--force-window=no","--speed=1.5","--start=20"]) assert.ok(launches[0].includes(arg),arg);
    assert.equal(reports.at(-1).speed,1.5);
    player.send({...load,output:{picture:true,sound:false}});pending.shift()("mpv");await settle();
    assert.ok(launches[1].includes("--aid=no"));
    assert.notEqual(addresses[0],addresses[1],"replacement IPC cannot attach to the retiring player");
    const socket=connections.at(-1);
    socket.emit("connect");
    const event=async message=>{socket.push(JSON.stringify(message)+"\\n");await settle();};
    await event({event:"file-loaded"});
    await event({event:"property-change",name:"paused-for-cache",data:true});
    assert.equal(reports.at(-1).status,"loading");
    assert.equal(reports.at(-1).buffering,true);
    player.send({type:"pause",playbackId:"same",paused:true});
    assert.deepEqual(commands.at(-1),["set_property","pause",true]);
    await event({event:"property-change",name:"pause",data:true});
    assert.equal(reports.at(-1).status,"paused","an explicit pause remains visible while mpv fills its cache");
    assert.equal(reports.at(-1).buffering,false);
    await event({event:"property-change",name:"paused-for-cache",data:false});
    assert.equal(reports.at(-1).status,"paused","cache recovery must not clear the user's pause");
    await event({event:"property-change",name:"pause",data:false});
    assert.equal(reports.at(-1).status,"playing");
    await event({event:"property-change",name:"paused-for-cache",data:true});
    await event({event:"end-file",reason:"eof"});
    await event({event:"property-change",name:"duration"});
    await event({event:"property-change",name:"pause",data:false});
    assert.equal(reports.at(-1).status,"ended","unloading the finished file must not revive loading or playing");
    children.at(-1).emit("exit",0);
    assert.equal(reports.at(-1).status,"ended","normal mpv exit preserves completion");
    player.send({...load,playbackId:"next"});
    assert.equal(reports.at(-1).status,"loading");
    assert.equal(reports.at(-1).buffering,false,"a replacement is loading, not buffering the previous source");
    player.send({type:"stop",playbackId:"next"});
    assert.equal(reports.at(-1).buffering,false);
    player.send({...load,playbackId:"lost-ipc"});
    pending.pop()("mpv");await settle();
    const lost=connections.at(-1);
    lost.emit("connect");
    lost.destroy(new Error("fixture reset"));
    await settle();
    assert.equal(reports.at(-1).status,"error","an IPC reset stops the player without crashing Core");
    assert.match(reports.at(-1).error,/connection/i);
    player.close();
  `,
    ],
    { cwd: new URL("../", import.meta.url), encoding: "utf8" },
  );
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});
