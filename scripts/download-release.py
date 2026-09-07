#!/usr/bin/env python3
"""Download an exact private successful Package artifact using the Mac's gh login."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import zipfile

REPOSITORY = 'avoid-quest/couch'


def api(path):
    return subprocess.check_output(['gh', 'api', f'repos/{REPOSITORY}/{path}'])


def download(artifact_id, destination):
    artifact = json.loads(api(f'actions/artifacts/{artifact_id}'))
    if artifact['expired'] or not re.fullmatch(r'couch-release-[1-9][0-9]*\.[1-9][0-9]*', artifact['name']):
        raise ValueError('Choose an unexpired immutable release artifact')
    identity = artifact['name'].removeprefix('couch-release-')
    run_id, attempt = identity.split('.')
    if str(artifact['workflow_run']['id']) != run_id:
        raise ValueError('Artifact run identity mismatch')
    run = json.loads(api(f'actions/runs/{run_id}'))
    if (run['conclusion'] != 'success' or run['event'] not in ['push', 'workflow_dispatch']
            or run['head_branch'] != 'main' or run['path'] != '.github/workflows/package.yml'
            or run['repository']['full_name'] != REPOSITORY or run['head_repository']['full_name'] != REPOSITORY
            or str(run['id']) != run_id or int(run['run_attempt']) < int(attempt)
            or artifact['workflow_run']['head_sha'] != run['head_sha']):
        raise ValueError('Artifact must come from a successful main Package push or manual run in the source repository')
    archive = api(f'actions/artifacts/{artifact_id}/zip')
    if artifact.get('digest') != 'sha256:' + hashlib.sha256(archive).hexdigest():
        raise ValueError('GitHub artifact SHA256 mismatch or missing digest')
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        manifest = json.loads(zipped.read('release.json'))
        ci = manifest['ci']
        if (manifest['releaseId'] != identity or manifest['build']['revision'] != run['head_sha']
                or ci['runId'] != run_id or ci['attempt'] != attempt or ci['ref'] != 'main'
                or ci['repository'] != REPOSITORY or ci['workflow'] != 'Package'):
            raise ValueError('Artifact source/run identity mismatch')
        names = ['release.json'] + [p['filename'] for p in manifest['packages']]
        if sorted(zipped.namelist()) != sorted(names) or any(Path(n).name != n for n in names):
            raise ValueError('Unexpected artifact files')
        for package in manifest['packages']:
            data = zipped.read(package['filename'])
            if len(data) != package['size'] or hashlib.sha256(data).hexdigest() != package['sha256']:
                raise ValueError('Package SHA256 mismatch')
        destination.mkdir(parents=True, exist_ok=False)
        for name in names:
            (destination / name).write_bytes(zipped.read(name))
    print(f'Verified artifact {artifact_id}, release {identity}, source {run["head_sha"]}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifact_id', type=int)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    download(args.artifact_id, args.destination)
