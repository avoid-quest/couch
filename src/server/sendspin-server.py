#!/usr/bin/env python3
"""Private Couch bridge. Sendspin SDK owns scheduling, transport and pairing."""
import asyncio
import base64
import contextlib
import json
import os
from pathlib import Path
import sys
from importlib.metadata import version

from aiosendspin.noise import Identity, FileServerPairingStore
from aiosendspin.noise.pairing import PairingAttempt
from aiosendspin.models.types import PairMethod
from aiosendspin.server import SendspinServer
from aiosendspin.server.audio import AudioFormat

MAX_LINE = 16384

class Bridge:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.server = None
        self.group = None
        self.stream = None
        self.epoch = 0
        self.playback = None
        self.frames = []
        self.last_position = 0
        self.pcm_task = None
        self.pair_tasks = {}
        self.pin_waiters = {}
        self.methods = {}
        self.last_snapshot = None
        self.members = []
        self.closed = False
        self.qualified_ids = set()
        self.format = AudioFormat(sample_rate=48000, bit_depth=16, channels=2)

    def emit(self, **message):
        print(json.dumps(dict(v=1, **message), separators=(",", ":")), flush=True)

    def save_members(self):
        path = self.directory / "members.json"
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.members))
        os.chmod(temporary, 0o600)
        temporary.replace(path)

    async def start(self, request):
        if self.server: raise ValueError("already_started")
        if version("aiosendspin") != "9.1.1": raise ValueError("unsupported_sdk_version")
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.directory.chmod(0o700)
        identity_path = self.directory / "identity.key"
        if identity_path.exists():
            identity = Identity.from_private_bytes(identity_path.read_bytes())
        else:
            identity = Identity.generate()
            with identity_path.open("xb") as output: output.write(identity.private_bytes)
            os.chmod(identity_path, 0o600)
        self.members = json.loads((self.directory / "members.json").read_text()) if (self.directory / "members.json").exists() else []
        if not isinstance(self.members, list) or len(self.members) > 32 or any(not isinstance(x,str) for x in self.members): raise ValueError("invalid_members")
        self.qualified_ids=set(request.get("qualifiedClientIds",[]))
        store = await FileServerPairingStore.open(self.directory / "trust.json")
        self.server = SendspinServer(loop=asyncio.get_running_loop(), identity=identity, server_name=request["name"], pairing_store=store, allow_noncompliant_clients=False)
        await self.server.start_server(port=request["port"],host=request["host"],advertise_addresses=[],discover_clients=False)
        self.monitor = asyncio.create_task(self.watch())

    async def watch(self):
        while not self.closed:
            try:
                await self.snapshot()
                if self.playback and self.stream:
                    self.position()
                    self.emit(event="position",epoch=self.epoch,playbackId=self.playback,position=self.last_position,buffering=not self.frames)
            except Exception:
                self.emit(event="error",code="backend_state",message="Sendspin backend state could not be confirmed.")
            await asyncio.sleep(.2)

    def position(self):
        if self.stream:
            now = self.stream.now_us()
            while self.frames and now >= self.frames[0][0] + self.frames[0][2]:
                _, position, duration, speed = self.frames.pop(0)
                self.last_position = position + duration / 1000000 * speed
            if self.frames:
                at, position, duration, speed = self.frames[0]
                self.last_position = position + max(0, min(duration, now-at)) / 1000000 * speed

    async def snapshot(self):
        records = {record.client_id for record in await self.server.pairing_store.list_records()}
        clients = self.server.clients
        if len(clients)>32: raise ValueError("too_many_clients")
        selected = [c for c in clients if c.client_id in self.members and c.is_connected and c.role("player@v1")]
        if self.group is not None and not self.group.clients: self.group=None
        if selected:
            if self.group is None: self.group = selected[0].group
            for client in selected:
                if client.group is not self.group: await self.group.add_client(client)
        result=[]
        for client in clients:
            role=client.role("player@v1")
            result.append(dict(id=client.client_id,name=client.name,connected=client.is_connected,joined=client.client_id in self.members,paired=client.client_id in records,volume=role.volume if role else 100,muted=role.muted if role else False,methods=[m.method.value for m in (client.info.supported_pair_methods or []) if m.method is PairMethod.DYNAMIC_PIN] if client.is_connected else [],qualified=bool(client.client_id in self.qualified_ids and role and role.static_delay_ms==0 and role.required_lead_time_ms<=500 and role.min_buffer_ms<=500)))
        encoded=json.dumps(result,sort_keys=True)
        if encoded!=self.last_snapshot:
            self.last_snapshot=encoded
            self.emit(event="members",members=result)
        if self.playback and not selected:
            await self.clear(self.epoch+1)
            self.emit(event="error",code="members_lost",message="All Sendspin outputs disconnected.")
        return result

    async def clear(self, epoch):
        if epoch<self.epoch: raise ValueError("stale_epoch")
        self.position()
        self.epoch=epoch
        if self.pcm_task and self.pcm_task is not asyncio.current_task():
            self.pcm_task.cancel()
            with contextlib.suppress(asyncio.CancelledError): await self.pcm_task
        if self.stream: self.stream.clear()
        if self.group: await self.group.stop()
        self.stream=None; self.frames=[]; self.playback=None

    async def command(self, request):
        op=request["op"]
        if op=="start": await self.start(request); return {}
        if not self.server: raise ValueError("not_started")
        if op=="snapshot": return dict(members=await self.snapshot())
        if op in ("clear","stop"):
            await self.clear(request["epoch"]); return dict(position=self.last_position)
        if op=="begin":
            await self.clear(request["epoch"])
            await self.snapshot()
            if request["epoch"]!=self.epoch: raise ValueError("stale_epoch")
            if not self.group or not any(c.is_connected and c.role("player@v1") for c in self.group.clients): raise ValueError("no_players")
            self.stream=self.group.start_stream(); self.playback=request["playbackId"]; self.last_position=request["position"]
            return {}
        if op=="pcm":
            if request["epoch"]!=self.epoch or not self.stream: raise ValueError("stale_epoch")
            pcm=base64.b64decode(request["data"],validate=True)
            if not pcm or len(pcm)>3840 or len(pcm)%4: raise ValueError("invalid_pcm")
            position=float(request["position"]); speed=float(request["speed"])
            if not 0<=position<1e10 or not .25<=speed<=4: raise ValueError("invalid_timing")
            stream=self.stream; epoch=self.epoch
            stream.prepare_audio(pcm,self.format); stamp=await stream.commit_audio()
            if epoch!=self.epoch: raise ValueError("stale_epoch")
            self.frames.append((stamp,position,len(pcm)/192000*1000000,speed))
            if len(self.frames)>128: raise ValueError("audio_backlog")
            await stream.sleep_to_limit_buffer(500000)
            return {}
        if op=="end":
            if request["epoch"]!=self.epoch: raise ValueError("stale_epoch")
            while self.frames and request["epoch"]==self.epoch: await asyncio.sleep(.02)
            if request["epoch"]==self.epoch:
                await self.clear(self.epoch)
            return dict(position=self.last_position)
        if op=="members":
            ids=request["ids"]
            if not isinstance(ids,list) or len(ids)>32 or len(set(ids))!=len(ids): raise ValueError("invalid_members")
            clients={c.client_id:c for c in self.server.connected_clients}
            if any(x not in clients or not clients[x].role("player@v1") for x in ids): raise ValueError("unpaired_member")
            if self.group:
                for client in list(self.group.clients):
                    if client.client_id not in ids: await self.group.remove_client(client)
            if self.group is not None and not self.group.clients: self.group=None
            if ids:
                if not self.group: self.group=clients[ids[0]].group
                for id in ids:
                    if clients[id].group is not self.group: await self.group.add_client(clients[id])
            self.members=ids;self.save_members();await self.snapshot();return {}
        if op=="volume":
            if request["clientId"] not in self.members: raise ValueError("not_a_member")
            client=self.server.get_client(request["clientId"]); role=client.role("player@v1") if client else None
            if not role or not isinstance(request["volume"],int) or not 0<=request["volume"]<=100 or not isinstance(request["muted"],bool): raise ValueError("invalid_volume")
            role.set_volume(request["volume"]);role.set_mute(request["muted"]);return {}
        if op=="pair":
            id=request["clientId"]
            client=self.server.get_client(id)
            if not client or not client.is_connected or not any(m.method is PairMethod.DYNAMIC_PIN for m in (client.info.supported_pair_methods or [])): raise ValueError("unsupported_pairing")
            if id in self.pair_tasks: raise ValueError("pairing_active")
            async def pin():
                waiter=asyncio.get_running_loop().create_future();self.pin_waiters[id]=waiter
                self.emit(event="pairing",clientId=id,stage="pin",methods=["dynamic_pin"])
                return await asyncio.wait_for(waiter,120)
            async def pairing():
                try:
                    await self.server.initiate_pairing(id,PairingAttempt(method=PairMethod.DYNAMIC_PIN,pin_provider=pin))
                    self.emit(event="pairing",clientId=id,stage="complete",methods=["dynamic_pin"])
                except asyncio.CancelledError: pass
                except Exception: self.emit(event="pairing",clientId=id,stage="error",methods=["dynamic_pin"])
                finally:self.pin_waiters.pop(id,None);self.pair_tasks.pop(id,None)
            self.pair_tasks[id]=asyncio.create_task(pairing());return {}
        if op=="pin":
            waiter=self.pin_waiters.get(request["clientId"]);pin=request["pin"]
            if not waiter or waiter.done() or not isinstance(pin,str) or not pin.isdigit() or not 6<=len(pin)<=12: raise ValueError("invalid_pin")
            waiter.set_result(pin);return {}
        if op=="pairCancel":
            task=self.pair_tasks.get(request["clientId"])
            if task:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError): await task
            client=self.server.get_client(request["clientId"])
            if client and client.is_connected: await self.server.end_pairing(request["clientId"])
            return {}
        if op=="unpair":
            id=request["clientId"]
            client=self.server.get_client(id)
            if client and self.group and client in self.group.clients: await self.group.remove_client(client)
            self.members=[member for member in self.members if member!=id];self.save_members()
            if client and client.is_connected:
                previous=client.connection
                await self.server.unpair(id)
                async with asyncio.timeout(3):
                    while client.connection is previous: await asyncio.sleep(.02)
            else: await self.server.pairing_store.remove_record(id)
            await self.snapshot();return {}
        if op=="close":
            self.closed=True
            await self.clear(self.epoch+1)
            for task in list(self.pair_tasks.values()):task.cancel()
            self.monitor.cancel();await self.server.close();return {}
        raise ValueError("unknown_operation")

async def main():
    bridge=Bridge(sys.argv[1]);tasks=set()
    async def handle(request):
        try:
            result=await bridge.command(request)
            bridge.emit(id=request["id"],ok=True,**result)
        except asyncio.CancelledError:
            bridge.emit(id=request["id"],ok=False,error="cancelled")
        except Exception:
            bridge.emit(id=request.get("id"),ok=False,error="Sendspin rejected the operation.")
    try:
        while not bridge.closed:
            line=await asyncio.to_thread(sys.stdin.buffer.readline,MAX_LINE+1)
            if not line:break
            if len(line)>MAX_LINE or not line.endswith(b"\n"):raise ValueError("oversized_message")
            request=json.loads(line)
            if not isinstance(request,dict) or request.get("v")!=1 or not isinstance(request.get("id"),int):raise ValueError("invalid_message")
            if len(tasks)>=32:raise ValueError("request_backlog")
            if request.get("op")=="pcm" and bridge.pcm_task and not bridge.pcm_task.done():raise ValueError("pcm_backlog")
            task=asyncio.create_task(handle(request));tasks.add(task);task.add_done_callback(tasks.discard)
            if request.get("op")=="pcm":bridge.pcm_task=task
            if request.get("op")=="close":await task;break
    finally:
        bridge.closed=True
        for task in list(tasks):task.cancel()
        if bridge.server:
            await bridge.clear(bridge.epoch+1)
            await bridge.server.close()

if __name__=="__main__":asyncio.run(main())
