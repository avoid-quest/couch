import importlib.util,pathlib,subprocess,sys,time,json,datetime,shlex
base=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('remote',base/'t480/remote.py');remote=importlib.util.module_from_spec(spec);spec.loader.exec_module(remote)
now=int(time.time());stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
remote_dir='/var/tmp/couch-acceptance-277-t480-public-a'
check=remote.run('test ! -e '+shlex.quote(remote_dir)+' && ps -o comm=,stat= -p 1253',capture_output=True,text=True,check=True)
assert 'bash' in check.stdout and 'S+' in check.stdout, 'Existing root pane is not idle'
offline_start=now+60;target_start=now+100;duration=600
command=shlex.join(['bash','/tmp/couch-277-install-public-preview-once.sh','/tmp/couch-277-production-a-manifest.json',remote_dir,str(target_start)])
remote.root(command)
log=(base/'offline'/('t480-a-observer-'+stamp+'.log')).open('w')
out=base/'offline'/('t480-a-'+stamp)
p=subprocess.Popen([sys.executable,str(base/'offline/mac-offline.py'),str(out),str(offline_start),str(duration)],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
log.close()
record={'scheduledAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'macObserverPid':p.pid,'macOfflineStartEpoch':offline_start,'targetStartEpoch':target_start,'durationSeconds':duration,'macEvidence':str(out),'targetEvidence':remote_dir,'rootSession':'couch-sudo','collector':'install-public-preview-once.sh'}
(base/'offline/t480-a-schedule.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record,indent=2))
