from pathlib import Path
import hashlib, ipaddress, json, re, urllib.parse
source = Path('.artifacts/acceptance-277/minimal-corrected-0.1.0')
out = Path('docs/evidence/acceptance-277/2026-09-15/minimal-corrected-0.1.0')
out.mkdir(parents=True, exist_ok=False)
entries = []
def digest(data): return hashlib.sha256(data).hexdigest()
def sanitize(text):
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
    text = re.sub(r'(?im)^(.*?\b(?:set-cookie|cookie|authorization|proxy-authorization):).*$', r'\1 <REDACTED>', text)
    def url(match):
        value = match.group(); parsed = urllib.parse.urlsplit(value)
        if parsed.query and parsed.query not in ('channel=preview', 'channel=stable'):
            return urllib.parse.urlunsplit(parsed._replace(query='REDACTED_QUERY'))
        return value
    text = re.sub(r'https?://[^\s<>"\']+', url, text)
    def address(match):
        try:
            value = ipaddress.ip_address(match.group())
            return '<PRIVATE_IP>' if value.is_private or value.is_loopback or value.is_link_local else match.group()
        except ValueError: return match.group()
    text = re.sub(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', address, text)
    return re.sub(r'\b(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b', '<MAC_ADDRESS>', text)
def retain(path, target):
    raw = path.read_bytes()
    data = sanitize(raw.decode()).encode() if path.suffix != '.wav' else raw
    dest = out / target; dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(data)
    entries.append({'source':str(path), 'retained':str(dest.relative_to(out)), 'sourceSha256':digest(raw), 'retainedSha256':digest(data), 'redacted':raw != data})
for path in sorted((source/'baseline').rglob('*')):
    if path.is_file(): retain(path, Path('baseline')/path.relative_to(source/'baseline'))
for path in sorted((source/'public-install-receipts').rglob('*')):
    if path.is_file(): retain(path, Path('public-install')/path.relative_to(source/'public-install-receipts'))
for path in sorted((source/'helpers').iterdir()):
    if path.is_file() and path.name not in ('AppRun','linuxdeploy-plugin-gtk.sh','linuxdeploy-plugin-gstreamer.sh'):
        retain(path, Path('helpers')/path.name)
for name in ['vm-identity.json','baseline-summary.json','public-install-dispatch.json','final-shutdown.json','final-vm-state.txt']:
    retain(source/name, Path(name))
for name in ['session-followup.txt','mute-confirmation.stdout','mute-confirmation.stderr','mute-confirmation.exit']:
    retain(source/name, Path('first-session')/name)
retain(source/'mount-cleanup.json',Path('helpers/mount-cleanup.json'))
for name in ['collect-baseline.sh','install-public-once.sh','helper-probe.py','retain-evidence.py']:
    retain(source/name,Path('collectors')/name)
(out/'source-retained-hashes.json').write_text(json.dumps(entries,indent=2)+'\n')
summary={'scope':'Fresh minimal Debian public installation, SSH-observed first session and mounted-runtime helpers; no GUI or playback acceptance', 'version':'0.1.0','revision':'61739ad7ce782da5482067f16a5727306cd65d6a','releaseId':'01M2H8T79E8KBGNXZ26640SMK6','channel':'preview','appimageSha256':'dd50813112c9643faddeedee46889e8102965c97f5d77bfd43d45756a20c6a05','vmId':'1A01E320-8A02-4C8C-850F-48C539F6FCF1','baselinePackages':321,'installedPackages':578,'installerExit':0,'publicFilesVerified':6,'signatureChecksPassed':3,'installedIdentityMatches':True,'fullDesktopInstalled':False,'nativeSession':{'firstObservedActive':'2026-09-15T01:35:05Z','lastObserved':'2026-09-15T01:38:12Z','pid':8355,'restartCount':0,'active':True,'memoryCurrentBytes':559075328},'helpersPassed':True,'helperMountRemoved':True,'audio':{'sink':'auto_null','sinkState':'SUSPENDED','muteConfirmed':False,'boundedConfirmationPolls':10,'reportedMute':'no','volumeObserved':False,'playbackRequested':False,'physicalAudioDevice':False},'shutdownExit':0,'vmStopped':True,'limitations':['No native GUI observation, local setup, controller pairing or playback test','No host reboot or Mac-offline claim','No five-minute idle or hardware performance qualification','Virtual sink mute verification failed; volume zero was not observed']}
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print('Retained',len(entries),'source-backed files')
