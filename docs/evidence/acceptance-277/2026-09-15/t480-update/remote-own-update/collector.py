#!/usr/bin/env python3
"""Seeded isolated remote-mode own-update with unreachable target. No UI selection or remote authorization claim."""
import shutil, sqlite3, urllib.error, base64, concurrent.futures, datetime, hashlib, http.server, json, os, pathlib, pwd, socket, struct, subprocess, threading, time, urllib.parse, urllib.request, uuid
ACCOUNT='ISOLATED_USER'; HOME=pathlib.Path('/home')/ACCOUNT; DATA=HOME/'remote-update-data'; APP=HOME/'.local/lib/couch'; ORIGIN='http://127.0.0.1:4200'; UNIT='couch-277-remote-update.service'; IDLE_UNIT='couch-277-idle.service'
assert os.geteuid()==0
user=pwd.getpwnam(ACCOUNT)
assert pathlib.Path(user.pw_dir)==HOME and user.pw_uid!=0
assert all(p.resolve()==p and p.is_dir() for p in (HOME, APP))
OUT=HOME/'evidence/remote-own-update'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'); OUT.mkdir(parents=True, exist_ok=False)
def save(name,obj): (OUT/name).write_text(json.dumps(obj,indent=2)+'\n')
def proc():
    result=[]
    for path in pathlib.Path('/proc').iterdir():
        if not path.name.isdigit(): continue
        try:
            if path.stat().st_uid==user.pw_uid and (path/'comm').read_text().strip() in {'couch','couch-server'}: result.append(int(path.name))
        except FileNotFoundError: pass
    return sorted(result)
discovered=[]
def endpoint():
    for pid in proc():
        try:
            env=dict(x.split(b'=',1) for x in pathlib.Path(f'/proc/{pid}/environ').read_bytes().split(b'\0') if b'=' in x)
            if env.get(b'COUCH_DATA_DIR')!=str(DATA).encode() or b'COUCH_HOST_TOKEN' not in env:continue
            assert env.get(b'COUCH_MAINTENANCE_ONLY')==b'1', 'Expected genuine maintenance-only coordinator'
            inodes=set()
            for fd in pathlib.Path(f'/proc/{pid}/fd').iterdir():
                try:
                    link=os.readlink(fd)
                    if link.startswith('socket:['):inodes.add(link[8:-1])
                except FileNotFoundError:pass
            listeners=[]
            for line in pathlib.Path(f'/proc/{pid}/net/tcp').read_text().splitlines()[1:]:
                row=line.split()
                if row[3]=='0A' and row[9] in inodes:
                    address,port=row[1].split(':');listeners.append({'addressHex':address,'port':int(port,16)})
            assert all(x['addressHex']=='0100007F' for x in listeners), 'Maintenance coordinator unexpectedly has a nonloopback listener'
            for listener in listeners:
                identity={'pid':pid,'port':listener['port'],'maintenanceOnly':True,'listeners':listeners}
                if identity not in discovered:discovered.append(identity)
                return 'http://127.0.0.1:'+str(listener['port']),env[b'COUCH_HOST_TOKEN'].decode()
        except (FileNotFoundError,ProcessLookupError):pass
    raise RuntimeError('No isolated maintenance listener yet')
def api(path,body=None,method=None):
    origin,credential=endpoint()
    req=urllib.request.Request(origin+path,data=None if body is None else json.dumps(body).encode(),method=method,headers={'Authorization':'Bearer '+credential,'Origin':'tauri://localhost','Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=10) as res:
        content=res.read();return json.loads(content) if content else None
def wait(label,fn,seconds=120):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        value=fn()
        if value:return value
        time.sleep(.2)
    raise RuntimeError('Timeout: '+label)
def ready():
    try:return api('/api/updates')
    except (OSError,RuntimeError):return None
def unit(*args):
    return subprocess.run(['runuser','-u',ACCOUNT,'--','env',f'XDG_RUNTIME_DIR=/run/user/{user.pw_uid}',f'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/{user.pw_uid}/bus','systemctl','--user',*args],text=True,capture_output=True,check=True).stdout
BACKUP=HOME/'backup-A';started=False;success=False;cleanup=[];request_id=uuid.uuid4().hex
choice={'mode':'remote','address':'http://127.0.0.1:49009','targets':['http://127.0.0.1:49009'],'localSetupComplete':True}
def sha(path):
    with open(path,'rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def stop():
    unit('stop',UNIT)
    for pid in proc():
        try:os.kill(pid,15)
        except ProcessLookupError:pass
    wait('isolated native stops',lambda:not proc(),30)
try:
    assert not DATA.exists() and not proc()
    assert unit('show','couch-277-x11.service','--property=ActiveState','--value').strip()=='active'
    assert unit('show','couch-277-activity.service','--property=ActiveState','--value').strip() in {'inactive','failed'}
    # Do not bind a fake target server. Connection refusal is the test condition.
    probe=socket.socket();probe.settimeout(1)
    assert probe.connect_ex(('127.0.0.1',49009))!=0,'Target must actually be unreachable';probe.close()
    assert BACKUP.is_dir() and BACKUP.resolve()==BACKUP
    assert sha(APP/'Couch.AppImage')==sha(BACKUP/'Couch.AppImage'),'Expected qualified A installed with retained A recovery copy'
    save('initial-installed-build.json',json.loads((APP/'build.json').read_text()))
    save('recovery-inputs.json',{'backup':str(BACKUP),'Asha256':sha(BACKUP/'Couch.AppImage'),'signatureSha256':sha(BACKUP/'Couch.AppImage.sig'),'recoveryExecutable':str(HOME/'.local/bin/couch-recover'),'runRecoveryOnlyAs':ACCOUNT})
    DATA.mkdir(mode=0o700);os.chown(DATA,user.pw_uid,user.pw_gid)
    (DATA/'operating-mode.json').write_text(json.dumps(choice));os.chown(DATA/'operating-mode.json',user.pw_uid,user.pw_gid)
    (DATA/'retained-fixture.txt').write_text('Seeded remote own-update fixture; retain across replacement.\n');os.chown(DATA/'retained-fixture.txt',user.pw_uid,user.pw_gid)
    preserved_hash=sha(DATA/'retained-fixture.txt')
    retained_candidate=HOME/'activity-data/updates/appimage/candidate.AppImage'
    if retained_candidate.is_file():
        candidate_dir=DATA/'updates/appimage';candidate_dir.mkdir(parents=True,mode=0o700)
        for directory in (DATA/'updates',candidate_dir):os.chown(directory,user.pw_uid,user.pw_gid)
        shutil.copy2(retained_candidate,candidate_dir/'candidate.AppImage');os.chown(candidate_dir/'candidate.AppImage',user.pw_uid,user.pw_gid)
    definition=unit('cat','couch-277-activity.service')
    assert str(APP/'Couch.AppImage') in definition and str(HOME/'activity-data') in definition
    definition=definition.replace(str(HOME/'activity-data'),str(DATA))
    path=HOME/'.config/systemd/user'/UNIT;assert not path.exists();path.write_text(definition);os.chown(path,user.pw_uid,user.pw_gid)
    save('fixture.json',{'seededChoice':choice,'unit':definition,'scope':'explicit seeded-state fixture, no GUI selection, pairing or target privilege claim'})
    unit('daemon-reload');started=True;unit('start',UNIT);initial=wait('maintenance coordinator',ready);save('A-maintenance.json',initial)
    wait('startup check settles',lambda:api('/api/updates')['status'] not in {'checking','downloading'},180)
    api('/api/updates/policy',{'policy':'manual'});api('/api/updates/channel',{'channel':'preview'})
    wait('preview check settles',lambda:api('/api/updates')['status']!='checking',180)
    state=api('/api/updates');assert state['status'] in {'available','ready'} and state['currentCheck']
    if state['status']!='ready':
        api('/api/updates/stage',{'candidateId':state['candidate']['id']});wait('stage settles',lambda:api('/api/updates')['status']!='downloading',1800)
    state=api('/api/updates');save('B-ready.json',state);assert state['status']=='ready'
    expected=state['candidate'];assert expected['revision'] and expected['version']!=state['running']['version']
    expected_hash=sha(DATA/'updates/appimage/candidate.AppImage');before_pids=proc()
    assert not (DATA/'couch.sqlite').exists(),'Maintenance mode created an unexpected media DB'
    save('request.json',{'requestId':request_id,'candidateId':expected['id'],'pids':before_pids,'archiveSha256':expected_hash})
    try:
        accepted=api('/api/updates/install',{'install':{'candidateId':expected['id'],'requestId':request_id,'confirmInterrupt':False}});save('accepted.json',accepted)
    except OSError as error:save('submission-transport.json',{'error':str(error),'note':'Poll durable receipt; do not infer failure from disconnect'})
    def complete():
        try:value=api('/api/updates?requestId='+request_id)
        except (OSError,RuntimeError):return None
        transaction=value['installation'].get('requestedTransaction')
        if transaction and transaction['phase'] in {'failed','operator-required','restored'}:
            save('terminal-failure.json',value);raise AssertionError('Update terminal failure: '+json.dumps(transaction))
        return value if transaction and transaction['phase']=='succeeded' else None
    final=wait('genuine remote-mode update commits',complete,240);save('terminal-success.json',final)
    tx=final['installation']['requestedTransaction']
    assert tx['version']==expected['version'] and tx['revision']==expected['revision']
    assert final['running']=={'version':expected['version'],'revision':expected['revision']}
    installed=json.loads((APP/'build.json').read_text());save('final-installed-build.json',installed)
    assert installed['version']==expected['version'] and installed['revision']==expected['revision'] and sha(APP/'Couch.AppImage')==expected_hash
    assert proc()!=before_pids and sha(DATA/'retained-fixture.txt')==preserved_hash
    assert json.loads((DATA/'operating-mode.json').read_text())==choice and not (DATA/'couch.sqlite').exists()
    probe=socket.socket();probe.settimeout(1);assert probe.connect_ex(('127.0.0.1',49009))!=0;probe.close()
    success=True
except Exception as error:save('FAILURE.json',{'error':str(error)});raise
finally:
    if started:
        try:api('/api/updates/policy',{'policy':'manual'});cleanup.append('manual retained')
        except Exception as error:cleanup.append('manual restore failed: '+str(error))
        try:stop();cleanup.append('isolated remote own-update service stopped')
        except Exception as error:cleanup.append('stop failed: '+str(error))
    save('maintenance-listeners.json',discovered);save('cleanup.json',cleanup)
    save('RESULT.json',{'passed':success and all('failed' not in x.lower() for x in cleanup),'scope':'seeded remote mode, unreachable saved target, genuine own signed hosted A-to-B update','frontendAck':'native frontend only; script never posts an acknowledgement','mediaDatabaseExpected':False,'recovery':'qualified A backup retained; never automatically restore on failure','cleanup':cleanup})
print(OUT)
