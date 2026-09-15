#!/usr/bin/env python3
"""Bounded Mac Wi-Fi outage with an independent automatic restoration process."""
import datetime,json,pathlib,subprocess,sys,time
out=pathlib.Path(sys.argv[1]).resolve()
start=int(sys.argv[2])
duration=int(sys.argv[3])
assert 30<=duration<=600
out.mkdir(mode=0o700,exist_ok=False)
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def call(args):return subprocess.run(args,capture_output=True,text=True,timeout=15)
def power():return call(['/usr/sbin/networksetup','-getairportpower','en0']).stdout.strip().rsplit(': ',1)[-1]
def state(probe=False):
    route=call(['/sbin/route','-n','get','default'])
    interface=next((x.split(':',1)[1].strip() for x in route.stdout.splitlines() if x.strip().startswith('interface:')),None)
    result={'at':utc(),'wifi':power(),'defaultInterface':interface,'defaultRouteExit':route.returncode}
    if probe:
        r=call(['/usr/bin/curl','--silent','--output','/dev/null','--connect-timeout','3','--max-time','4','--write-out','%{http_code}','https://couch.avoid.quest/couch-updater.pub'])
        result.update(probeExit=r.returncode,probeHttpStatus=r.stdout)
    return result
def record(event,**values):
    with (out/'events.jsonl').open('a') as f:f.write(json.dumps({'event':event,'at':utc(),**values})+'\n')
initial=state(True)
record('initial',state=initial,scheduledStart=start,durationSeconds=duration)
assert initial['wifi']=='On' and initial['defaultInterface']=='en0' and initial['probeExit']==0
assert start-time.time()<=180
if start>time.time():time.sleep(start-time.time())
awake=subprocess.Popen(['/usr/bin/caffeinate','-i','-t',str(duration+180)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
record('idle-sleep-inhibited',pid=awake.pid,durationSeconds=duration+180)
restoration_code="""import datetime,json,pathlib,subprocess,sys,time
time.sleep(int(sys.argv[2]))
results=[]
for attempt in range(3):
 r=subprocess.run(['/usr/sbin/networksetup','-setairportpower','en0','on'],capture_output=True,text=True,timeout=15)
 results.append({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exit':r.returncode})
 if r.returncode==0:break
 time.sleep(5)
pathlib.Path(sys.argv[1]).write_text(json.dumps(results,indent=2)+chr(10))
"""
with (out/'restoration-process.log').open('w') as f:
    insurance=subprocess.Popen([sys.executable,'-c',restoration_code,str(out/'automatic-restoration.json'),str(duration+45)],stdin=subprocess.DEVNULL,stdout=f,stderr=f,start_new_session=True)
assert insurance.poll() is None
record('restoration-scheduled',pid=insurance.pid,delaySeconds=duration+45)
try:
    r=call(['/usr/sbin/networksetup','-setairportpower','en0','off'])
    record('disable-wifi',exit=r.returncode)
    assert r.returncode==0
    for attempt in range(10):
        observed=state(True)
        if observed['wifi']=='Off' and observed['defaultInterface'] is None and observed['probeExit']!=0:break
        time.sleep(1)
    record('offline-start',state=observed)
    assert observed['wifi']=='Off' and observed['defaultInterface'] is None and observed['probeExit']!=0
    deadline=time.monotonic()+duration
    while time.monotonic()<deadline:
        time.sleep(max(0,min(30,deadline-time.monotonic())))
        observed=state()
        record('offline-check',state=observed)
        assert observed['wifi']=='Off' and observed['defaultInterface'] is None
    observed=state(True)
    record('offline-end',state=observed)
    assert observed['wifi']=='Off' and observed['defaultInterface'] is None and observed['probeExit']!=0
finally:
    r=call(['/usr/sbin/networksetup','-setairportpower','en0','on'])
    record('enable-wifi',exit=r.returncode)
    restored=None
    for attempt in range(12):
        restored=state(True)
        if restored['wifi']=='On' and restored['defaultInterface']=='en0' and restored['probeExit']==0:break
        time.sleep(5)
    record('restored',state=restored)
    recovered=restored['wifi']=='On' and restored['defaultInterface']=='en0' and restored['probeExit']==0
    if recovered and insurance.poll() is None:
        insurance.terminate()
        insurance.wait(timeout=10)
        record('unused-restoration-timer-stopped')
    assert recovered, 'Mac connectivity was not verified restored; automatic restoration remains scheduled.'
print(json.dumps({'evidence':str(out),'restored':restored}))
