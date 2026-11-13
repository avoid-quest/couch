import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readPlayerSearch, remotePlayerSession } from "../src/client/session/player-control";
import type { SessionGateValue } from "../src/client/session/session-context";
import type { Action } from "../src/shared/protocol";

const tvB = "b".repeat(43),
  tvA = "a".repeat(43);

test("relative seeks reach Core during buffering and retain their destination", () => {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    const sent=[];
    let player={playbackId:"programme",status:"loading",buffering:true,seekable:true,position:12,duration:60};
    const state=()=>({player,playback:"group",queue:[],currentEntryId:null});
    Object.assign(globalThis,{
      window:{isSecureContext:false},location:new URL("http://localhost/"),
      localStorage:{getItem:()=>"fixture",setItem(){},removeItem(){}}
    });
    // Replace the browser/connection boundaries; exercise SessionGate's real relative-seek handler.
    mock.module("./src/client/session/session",()=>({useSession:()=>({
      state:state(),readObservation:state,connected:true,
      clock:{playbackId:"programme",position:12,duration:60},
      command:async(action,target)=>{sent.push({action,target});}
    })}));
    mock.module("./src/client/session/device-id",()=>({
      deviceId:()=>"receiver",useLocalDeviceName:()=>"Receiver",announcePlay(){},
      loadLocalDeviceName(){},saveLocalDeviceName(){}
    }));
    mock.module("./src/client/sections/shell/PlaybackDevice",()=>({usePlaybackDevice:()=>null}));
    mock.module("./src/client/interface-size",()=>({useInterfaceSize(){}}));
    mock.module("./src/client/toasts",()=>({dismissAll(){},dismissUndo(){},queued(){},undoable(){}}));
    const {SessionGate,useSessionGate}=await import("./src/client/session/session-context.tsx");
    let gate;
    renderToStaticMarkup(createElement(SessionGate,{upNext(){}},createElement(()=>{
      gate=useSessionGate();return null;
    })));
    assert.equal(await gate.seekBy(10,"tv"),true);
    assert.deepEqual(sent,[{action:{type:"seek",playbackId:"programme",position:10,relative:true},target:"tv"}]);
    player={...player,position:58};
    await gate.seekBy(10);
    assert.equal(sent.at(-1).action.position,10);
    assert.equal(sent.at(-1).action.relative,true);
    await gate.seekBy(-100);
    assert.equal(sent.at(-1).action.position,-100);
    player={...player,buffering:false};
    assert.equal(await gate.seekBy(10),false,"initial loading has no seekable transport yet");
    assert.equal(sent.length,3);
  `,
    ],
    { cwd: new URL("../", import.meta.url), encoding: "utf8" },
  );
  assert.equal(result.stderr, "");
  assert.equal(result.status, 0);
});

function fixture() {
  const calls: { action: Action | number; target?: string }[] = [];
  const session = {
    connected: true,
    state: {
      controlling: tvB,
      playback: "sequence",
      outputs: [{ deviceId: tvB }],
      queue: [{ id: "waiting" }],
      devices: [
        { id: tvB, name: "TV B", tv: true, online: true, sharing: { audio: true, video: true } },
      ],
    },
    run: async (action: Action, target?: string) => {
      calls.push({ action, target });
      return true;
    },
    command: async (action: Action, target?: string) => {
      calls.push({ action, target });
    },
    seekBy: async (seconds: number, target?: string) => {
      calls.push({ action: seconds, target });
      return true;
    },
  } as unknown as SessionGateValue;
  return { session, calls };
}

test("a captured queue handler and shortcut keep the route's TV after another selection is rendered", async () => {
  const { session, calls } = fixture();
  const route = readPlayerSearch({ queue: "true", targetDeviceId: tvB });
  assert.deepEqual(route, { queue: true, targetDeviceId: tvB });
  const selected = remotePlayerSession(session, route.targetDeviceId!);
  const remove = () => selected.run({ type: "remove", entryId: "waiting" });
  const seek = () => selected.seekBy(10);
  const changed = {
    ...session,
    state: { ...session.state!, controlling: tvA, outputs: [{ deviceId: tvA }] },
  };
  assert.equal(remotePlayerSession(changed, tvB).state, null);
  await remove();
  await seek();
  await selected.command({ type: "restoreRemoved", token: "undo-token" });
  assert.deepEqual(
    calls.map((call) => call.target),
    [tvB, tvB, tvB],
  );
  // The ordinary session remains unscoped when the route is left.
  await session.run({ type: "remove", entryId: "ordinary" });
  assert.equal(calls.at(-1)?.target, undefined);
});

test("stale/foreign player snapshots, offline, private and disconnected targets disable the whole scoped journey", async () => {
  const { session, calls } = fixture();
  const state = session.state!;
  for (const changed of [
    { ...session, state: { ...state, controlling: tvA } },
    { ...session, state: { ...state, outputs: [{ deviceId: tvA }] } },
    {
      ...session,
      state: { ...state, devices: state.devices!.map((device) => ({ ...device, online: false })) },
    },
    {
      ...session,
      state: {
        ...state,
        devices: state.devices!.map((device) => ({
          ...device,
          sharing: { audio: false, video: false },
        })),
      },
    },
    { ...session, connected: false },
  ]) {
    const scoped = remotePlayerSession(changed, tvB);
    assert.equal(scoped.connected, false);
    assert.equal(await scoped.run({ type: "stop" }), false);
    assert.equal(await scoped.seekBy(10), false);
    await assert.rejects(scoped.command({ type: "restoreRemoved", token: "undo-token" }));
  }
  assert.deepEqual(calls, []);
});
