#!/usr/bin/env python3
"""Isolated corrupt retained candidate acceptance. Never executes production paths."""
import shutil, sqlite3, urllib.error, base64, concurrent.futures, datetime, hashlib, http.server, json, os, pathlib, pwd, socket, struct, subprocess, threading, time, urllib.parse, urllib.request, uuid
ACCOUNT='ISOLATED_USER'; HOME=pathlib.Path('/home')/ACCOUNT; DATA=HOME/'activity-data'; APP=HOME/'.local/lib/couch'; ORIGIN='http://127.0.0.1:4200'; UNIT='couch-277-activity.service'; IDLE_UNIT='couch-277-idle.service'
assert os.geteuid()==0
user=pwd.getpwnam(ACCOUNT)
assert pathlib.Path(user.pw_dir)==HOME and user.pw_uid!=0
assert all(p.resolve()==p and p.is_dir() for p in (HOME, APP))
OUT=HOME/'evidence/corrupt-candidate'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'); OUT.mkdir(parents=True, exist_ok=False)
def save(name,obj): (OUT/name).write_text(json.dumps(obj,indent=2)+'\n')
def proc():
    result=[]
    for path in pathlib.Path('/proc').iterdir():
        if not path.name.isdigit(): continue
        try:
            if path.stat().st_uid==user.pw_uid and (path/'comm').read_text().strip() in {'couch','couch-server'}: result.append(int(path.name))
        except FileNotFoundError: pass
    return sorted(result)
def token():
    for pid in proc():
        try:
            env=dict(x.split(b'=',1) for x in pathlib.Path(f'/proc/{pid}/environ').read_bytes().split(b'\0') if b'=' in x)
            if env.get(b'COUCH_DATA_DIR')==str(DATA).encode() and b'COUCH_HOST_TOKEN' in env: return env[b'COUCH_HOST_TOKEN'].decode()
        except FileNotFoundError: pass
    raise RuntimeError('No isolated server credential')
def api(path,body=None,method=None):
    req=urllib.request.Request(ORIGIN+path,data=None if body is None else json.dumps(body).encode(),method=method,headers={'Authorization':'Bearer '+token(),'Origin':ORIGIN,'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=100) as res:
        data=res.read(); return json.loads(data) if data else None
def wait(label,fn,seconds=120):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        value=fn()
        if value:return value
        time.sleep(.2)
    raise RuntimeError('Timeout: '+label)
def ready():
    try:return api('/api/build')
    except (OSError,RuntimeError):return None
def unit(*args):
    return subprocess.run(['runuser','-u',ACCOUNT,'--','env',f'XDG_RUNTIME_DIR=/run/user/{user.pw_uid}',f'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/{user.pw_uid}/bus','systemctl','--user',*args],text=True,capture_output=True,check=True).stdout
CANDIDATE=DATA/'updates/appimage/candidate.AppImage'
PRESERVED=OUT/'candidate-original.AppImage'
started=False;original_hash=None;success=False;cleanup=[]
def sha(path):
    with open(path,'rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def stop():
    unit('stop',UNIT)
    for pid in proc():
        try:os.kill(pid,15)
        except ProcessLookupError:pass
    wait('isolated processes stop',lambda:not proc(),30)
def start():
    global started
    started=True;unit('start',UNIT);wait('native server',ready)
    wait('startup check settles',lambda:api('/api/updates')['status'] not in {'checking','downloading'},180)
    api('/api/updates/policy',{'policy':'manual'})
def check():
    api('/api/updates/check',{'check':True})
    wait('check settles',lambda:api('/api/updates')['status']!='checking',180)
    return api('/api/updates')
def flip(label):
    assert CANDIDATE.is_file() and not CANDIDATE.is_symlink() and CANDIDATE.stat().st_size>4096
    offset=CANDIDATE.stat().st_size-17
    with CANDIDATE.open('r+b') as stream:
        stream.seek(offset);before=stream.read(1);stream.seek(offset);stream.write(bytes([before[0]^1]));stream.flush();os.fsync(stream.fileno())
    changed=sha(CANDIDATE);assert changed!=original_hash
    save(label,{'offset':offset,'originalSha256':original_hash,'corruptSha256':changed,'size':CANDIDATE.stat().st_size})
def restore():
    if original_hash is None:return
    assert PRESERVED.is_file() and sha(PRESERVED)==original_hash
    temporary=CANDIDATE.with_name('candidate.restore-'+uuid.uuid4().hex)
    shutil.copy2(PRESERVED,temporary);os.chown(temporary,user.pw_uid,user.pw_gid)
    assert temporary.stat().st_ino!=PRESERVED.stat().st_ino
    os.replace(temporary,CANDIDATE);assert sha(CANDIDATE)==original_hash

def quickcheck():
    db=sqlite3.connect('file:'+str(DATA/'couch.sqlite')+'?mode=ro',uri=True)
    try:return db.execute('PRAGMA quick_check').fetchall()
    finally:db.close()
try:
    assert DATA.resolve()==DATA and DATA.is_dir()
    assert unit('show',UNIT,'--property=ActiveState','--value').strip() in {'inactive','failed'}
    assert not proc(),'Another isolated native is running'
    definition=unit('cat',UNIT)
    assert str(DATA) in definition and str(APP/'Couch.AppImage') in definition
    start();initial=api('/api/updates');save('initial-updates.json',initial)
    api('/api/updates/channel',{'channel':'preview'})
    wait('preview check',lambda:api('/api/updates')['status']!='checking',180)
    initial=api('/api/updates')
    if initial['status']=='available':
        api('/api/updates/stage',{'candidateId':initial['candidate']['id']})
        wait('stage',lambda:api('/api/updates')['status']!='downloading',1800)
    initial=api('/api/updates');save('initial-verified-ready.json',initial)
    assert initial['status']=='ready' and initial['currentCheck']
    candidate_id=initial['candidate']['id'];running=api('/api/build');a_hash=sha(APP/'Couch.AppImage')
    old_transaction=initial['installation']['transaction']
    assert not old_transaction or old_transaction['phase'] in {'succeeded','failed','restored','operator-required'}
    stop()
    shutil.copy2(CANDIDATE,PRESERVED)
    assert CANDIDATE.stat().st_ino!=PRESERVED.stat().st_ino
    original_hash=sha(CANDIDATE);assert sha(PRESERVED)==original_hash
    # Case one: startup/check must reject retained corruption as unready.
    flip('corruption-before-start.json');start()
    state=check();save('case1-check.json',state)
    assert state['currentCheck'] and state['status']=='available' and state['candidate']['id']==candidate_id
    assert api('/api/build')==running and sha(APP/'Couch.AppImage')==a_hash
    # Restore valid bytes, explicitly re-establish readiness, then corrupt after selection.
    restore();state=check();save('restored-ready-between-cases.json',state)
    assert state['status']=='ready' and state['currentCheck'] and state['candidate']['id']==candidate_id
    before_pids=proc();before_transaction=state['installation']['transaction'];request_id=uuid.uuid4().hex
    flip('corruption-after-ready.json')
    body={'install':{'candidateId':candidate_id,'requestId':request_id,'confirmInterrupt':False}}
    try:
        result=api('/api/updates/install',body)
        save('case2-unexpected-accepted.json',result)
        raise AssertionError('Corrupt candidate install unexpectedly accepted; inspect receipts')
    except urllib.error.HTTPError as error:
        raw=error.read().decode();response=json.loads(raw)
        save('case2-http-rejection.json',{'status':error.code,'body':response,'requestId':request_id,'limitation':'Current HTTP handler obscures native verification message; this is pre-acceptance rejection, not terminal failed transaction.'})
        assert error.code==400 and response.get('error')=='The update request did not finish. Refresh status before retrying.'
    status=api('/api/updates?requestId='+request_id);save('case2-status.json',status)
    assert status['installation']['requestedTransaction'] is None
    assert status['installation']['transaction']==before_transaction
    assert not (DATA/'updates/appimage/requests'/(request_id+'.json')).exists()
    assert proc()==before_pids and sha(APP/'Couch.AppImage')==a_hash and api('/api/build')==running
    assert quickcheck()==[('ok',)]
    unavailable=check();save('case2-followup-check.json',unavailable)
    assert unavailable['status']=='available' and unavailable['currentCheck']
    restore();verified=check();save('final-verified-ready.json',verified)
    assert verified['status']=='ready' and verified['candidate']['id']==candidate_id
    success=True
except Exception as error:
    save('FAILURE.json',{'error':str(error)});raise
finally:
    if started:
        try:api('/api/updates/policy',{'policy':'manual'});cleanup.append('manual policy restored')
        except Exception as error:cleanup.append('manual policy restore failed: '+str(error))
        try:stop();cleanup.append('activity service and isolated native stopped')
        except Exception as error:cleanup.append('stop failed: '+str(error))
        # Never change retained candidate while an unexpected native operation is still running.
        if not proc():
            try:restore();cleanup.append('original candidate bytes restored with distinct inode')
            except Exception as error:cleanup.append('candidate restore failed: '+str(error))
    save('cleanup.json',cleanup)
    save('RESULT.json',{'passed':success and all('failed' not in x.lower() for x in cleanup),'cases':['corrupt retained bytes unavailable after restart/check','corrupt bytes rejected before install acceptance'],'nativeError':'The saved download failed verification. Download it again.','nativeErrorEvidence':'source inspection only; HTTP handler returns generic error','terminalFailedReceiptClaimed':False,'cleanup':cleanup})
print(OUT)
