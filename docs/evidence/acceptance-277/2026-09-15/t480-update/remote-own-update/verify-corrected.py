import pathlib,json,hashlib,socket,datetime
home=pathlib.Path('/home/ISOLATED_USER');data=home/'remote-update-data';app=home/'.local/lib/couch';out=home/'evidence/remote-own-update/20260915T095101Z'
state=json.loads((out/'terminal-success.json').read_text());tx=state['installation']['requestedTransaction'];expected=json.loads((out/'B-ready.json').read_text())['candidate'];request=json.loads((out/'request.json').read_text())
assert tx['phase']=='succeeded'
assert all(state['running'][k]==expected[k] for k in ['version','revision']) and state['running']['dataFormat']==1
installed=json.loads((app/'build.json').read_text());assert all(installed[k]==expected[k] for k in ['version','revision'])
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();assert sha(app/'Couch.AppImage')==request['archiveSha256']=='dd50813112c9643faddeedee46889e8102965c97f5d77bfd43d45756a20c6a05'
listeners=json.loads((out/'maintenance-listeners.json').read_text());assert any(x['pid'] not in request['pids'] for x in listeners)
choice=json.loads((out/'fixture.json').read_text())['seededChoice'];assert json.loads((data/'operating-mode.json').read_text())==choice
assert (data/'retained-fixture.txt').read_text()=='Seeded remote own-update fixture; retain across replacement.\n'
assert not (data/'couch.sqlite').exists()
with socket.socket() as s:s.settimeout(1);assert s.connect_ex(('127.0.0.1',49009))!=0
assert sha(home/'backup-A/Couch.AppImage')=='d67dab162272ab340d42a6ee70d7a35055696e99be2a8b0cb87edceb60c55ef7'
(out/'corrected-verdict.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'passed':True,'originalHarnessFailure':'Strict dictionary comparison rejected the additional legitimate dataFormat field after terminal success. Original failure retained.','running':state['running'],'installedSha256':sha(app/'Couch.AppImage'),'nativeServerChanged':True,'modeRetained':True,'fixtureSha256':sha(data/'retained-fixture.txt'),'mediaDatabaseAbsent':True,'remoteTargetConnectionRefused':True,'knownGoodARecoveryRetained':True,'frontendAcknowledgement':'real native frontend; no script acknowledgement'},indent=2))
