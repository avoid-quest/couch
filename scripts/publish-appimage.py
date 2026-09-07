#!/usr/bin/env python3
"""Publish already-qualified bytes using the official Tauri signer."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
from urllib.parse import quote, urlparse


def digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def order(version):
    match = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)\+build\.([1-9]\d*)\.([1-9]\d*)', version)
    if not match:
        raise ValueError('Expected PRODUCT+build.RUN.ATTEMPT version')
    return tuple(map(int, match.groups()))


def sign(path):
    # The official CLI reads TAURI_SIGNING_PRIVATE_KEY_PATH and its password.
    subprocess.run(['bunx', '--no-install', 'tauri', 'signer', 'sign', str(path)],
                   check=True, stdout=subprocess.DEVNULL)
    signature = Path(str(path) + '.sig').read_text().strip()
    if not signature:
        raise ValueError('The Tauri signer returned no signature')
    return signature


def point(path, target):
    temporary = path.with_name(path.name + '.tmp')
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    os.replace(temporary, path)


def publish(artifact, evidence, feed, base, channel, notes):
    parsed = urlparse(base)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Expected an HTTP(S) feed base without credentials, query or fragment')
    base = base.rstrip('/') + '/'
    build = json.loads((artifact / 'build-info.json').read_text())
    qualification = json.loads(evidence.read_text())
    version = build['version']
    order(version)
    release_id = version.split('+build.')[1]
    if build.get('dirty') is not False or build.get('packaged') is not True or build.get('target') != 'x86_64-unknown-linux-gnu' or build.get('dataFormat') != 1 or not re.fullmatch('[a-f0-9]{40}', build['revision']):
        raise ValueError('Expected a clean compatible packaged build')
    archives = list(artifact.glob('*.AppImage'))
    if len(archives) != 1:
        raise ValueError('Expected exactly one AppImage')
    archive = archives[0]
    sha = digest(archive)
    if qualification.get('build') != build or qualification.get('packageSha256') != sha or qualification.get('format') != 'AppImage' or not qualification.get('checks'):
        raise ValueError('Qualification does not match these AppImage bytes and build')
    if not (artifact / 'couch-source.tar.gz').is_file():
        raise ValueError('Retain the matching source archive in private release storage')
    feed.mkdir(parents=True, exist_ok=True)
    with (feed / '.publish.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = feed / f'{channel}.json'
        if current.exists() and order(json.loads(current.read_text())['version']) > order(version):
            raise ValueError('A channel cannot move backwards')
        releases = feed / 'releases'
        releases.mkdir(exist_ok=True)
        destination = releases / release_id
        if destination.exists():
            if digest(destination / archive.name) != sha or json.loads((destination / 'build-info.json').read_text()) != build:
                raise ValueError('An existing release identity cannot change bytes or build')
        else:
            with tempfile.TemporaryDirectory(prefix='.release-', dir=releases) as temporary:
                staging = Path(temporary)
                shutil.copyfile(archive, staging / archive.name)
                shutil.copyfile(artifact / 'build-info.json', staging / 'build-info.json')
                sign(staging / archive.name)
                # Source and qualification evidence stay in private administrator storage.
                os.rename(staging, destination)
        signature = (destination / (archive.name + '.sig')).read_text().strip()
        now = int(time.time())
        metadata = dict(version=version, notes=notes, pub_date=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now)),
                        platforms={'linux-x86_64': {'url': base + 'releases/' + release_id + '/' + quote(archive.name), 'signature': signature}},
                        revision=build['revision'], releaseId=release_id, bytes=archive.stat().st_size, expiresAt=(now + 7 * 86400) * 1000)
        snapshots = feed / '.metadata'
        snapshots.mkdir(exist_ok=True)
        snapshot = Path(tempfile.mkdtemp(prefix=release_id + '-', dir=snapshots))
        try:
            (snapshot / 'release.json').write_text(json.dumps(metadata, indent=2) + '\n')
            sign(snapshot / 'release.json')
            # One pointer switches JSON and signature together; old snapshots remain readable.
            for name, target in ((f'{channel}.json', f'{channel}/release.json'), (f'{channel}.json.sig', f'{channel}/release.json.sig')):
                path = feed / name
                if path.is_symlink():
                    if os.readlink(path) != target:
                        raise ValueError('Unexpected channel link')
                elif path.exists():
                    raise ValueError('Refusing to replace a non-channel file')
                else:
                    path.symlink_to(target)
            for name in ('release.json', 'release.json.sig'):
                path = destination / name
                target = 'metadata/' + name
                if not path.is_symlink():
                    if path.exists():
                        raise ValueError('Unexpected retained metadata file')
                    path.symlink_to(target)
            point(destination / 'metadata', '../../.metadata/' + snapshot.name)
            point(feed / channel, '.metadata/' + snapshot.name)
        except Exception:
            # Once referenced, retain the signed snapshot even if a later pointer update fails.
            if not any(p.is_symlink() and snapshot.name in os.readlink(p) for p in (destination / 'metadata', feed / channel)):
                shutil.rmtree(snapshot)
            raise
    return metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifact', type=Path)
    parser.add_argument('qualification', type=Path)
    parser.add_argument('feed', type=Path)
    parser.add_argument('base_url')
    parser.add_argument('channel', choices=['stable', 'preview'])
    parser.add_argument('--notes', required=True)
    args = parser.parse_args()
    build = json.loads((args.artifact / 'build-info.json').read_text())
    run_id, attempt = build['version'].split('+build.')[1].split('.')
    run = json.loads(subprocess.check_output(['gh', 'api', f'repos/avoid-quest/couch/actions/runs/{run_id}']))
    if run['conclusion'] != 'success' or run['head_branch'] != 'main' or run['head_sha'] != build['revision'] or run['event'] != 'workflow_dispatch' or run['path'] != '.github/workflows/package.yml' or int(run['run_attempt']) < int(attempt):
        raise ValueError('Publication requires a successful main Package run matching the exact build')
    artifacts = json.loads(subprocess.check_output(['gh', 'api', f'repos/avoid-quest/couch/actions/runs/{run_id}/artifacts']))['artifacts']
    if not any(item['name'] == f'couch-appimage-{run_id}.{attempt}' and not item['expired'] for item in artifacts):
        raise ValueError('The run has no retained qualified AppImage artifact for this build')
    result = publish(args.artifact.resolve(), args.qualification.resolve(), args.feed.resolve(), args.base_url, args.channel, args.notes)
    print(f"Published {args.channel}: {result['version']} ({result['revision']})")
