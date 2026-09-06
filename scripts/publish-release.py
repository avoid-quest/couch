#!/usr/bin/env python3
"""Publish a qualified artifact to a static, signed APT feed. Run on Ubuntu."""
import argparse
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def run(*args, **kwargs):
    return subprocess.check_output(args, **kwargs).decode().strip()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_release(directory):
    manifest = json.loads((directory / 'release.json').read_text())
    identity = manifest['releaseId']
    if not re.fullmatch(r'[1-9][0-9]*\.[1-9][0-9]*', identity):
        raise ValueError('Invalid release identity')
    version = manifest['build']['version']
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+\+build\.' + re.escape(identity), version):
        raise ValueError('Version must identify this CI attempt')
    build = manifest['build']
    if build['dirty'] or not build['packaged'] or build['target'] != 'x86_64-unknown-linux-gnu' or not re.fullmatch(r'[a-f0-9]{40}', build['revision']):
        raise ValueError('Unsupported build identity')
    if manifest['ci']['ref'] != 'main' or manifest['ci']['repository'] != 'avoid-quest/couch' or manifest['ci']['workflow'] != 'Package':
        raise ValueError('Only qualified Preview integration builds may be published')
    if identity != f"{manifest['ci']['runId']}.{manifest['ci']['attempt']}":
        raise ValueError('CI identity mismatch')
    if not manifest['qualification']['checks'] or not manifest['releaseNotes'].strip():
        raise ValueError('Qualification and release notes are required')
    packages = manifest['packages']
    if {p['name'] for p in packages} != {'couch', 'couch-appliance'} or len(packages) != 2:
        raise ValueError('Both release packages are required')
    for package in packages:
        filename = package['filename']
        if not re.fullmatch(r'[A-Za-z0-9_.+~-]+\.deb', filename):
            raise ValueError('Invalid package filename')
        path = directory / filename
        if path.is_symlink() or path.stat().st_size != package['size'] or digest(path) != package['sha256']:
            raise ValueError(f'Package digest mismatch: {filename}')
        arch = 'amd64' if package['name'] == 'couch' else 'all'
        if package['version'] != version or package['architecture'] != arch:
            raise ValueError('Package identity mismatch')
        fields = run('dpkg-deb', '--field', str(path), 'Package', 'Version', 'Architecture')
        if dict(line.split(': ', 1) for line in fields.splitlines()) != {'Package': package['name'], 'Version': version, 'Architecture': arch}:
            raise ValueError('Debian control identity mismatch')
    return manifest


def publish(artifact, root, channel, key):
    root.mkdir(parents=True, exist_ok=True)
    # One publisher owns the entire feed, including monotonic checks and commit.
    with (root / '.publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        manifest = read_release(artifact)
        identity = manifest['releaseId']
        releases = root / 'releases'
        releases.mkdir(exist_ok=True)
        destination = releases / identity
        history = root / '.preview-history'
        history.mkdir(exist_ok=True)
        if channel == 'stable' and not (history / identity).is_file():
            raise ValueError('Stable must promote a previously published Preview artifact')
        if destination.exists():
            existing = read_release(destination)
            if existing != manifest:
                raise ValueError('An immutable release already exists with different metadata')
        else:
            staging = Path(tempfile.mkdtemp(prefix='.release-', dir=releases))
            try:
                for name in ['release.json'] + [p['filename'] for p in manifest['packages']]:
                    shutil.copyfile(artifact / name, staging / name)
                read_release(staging)
                os.rename(staging, destination)
            finally:
                if staging.exists():
                    shutil.rmtree(staging)
        dists = root / 'dists'
        dists.mkdir(exist_ok=True)
        current = dists / channel
        if current.exists():
            previous = json.loads((current / 'release.json').read_text())
            if subprocess.call(['dpkg', '--compare-versions', manifest['build']['version'], 'lt', previous['build']['version']]) == 0:
                raise ValueError('Refusing to move a channel backwards')
            if previous['releaseId'] == identity:
                # Refresh only signed metadata expiry. Immutable release bytes stay fixed.
                if previous != manifest:
                    raise ValueError('Existing channel metadata differs')
        snapshots = root / 'snapshots'
        snapshots.mkdir(exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=f'{channel}-{identity}-', dir=snapshots))
        committed = False
        try:
            binary = staging / 'main/binary-amd64'
            binary.mkdir(parents=True)
            paragraphs = []
            for package in manifest['packages']:
                package_path = destination / package['filename']
                control = run('dpkg-deb', '--field', str(package_path))
                paragraphs.append(f"{control}\nFilename: releases/{identity}/{package['filename']}\nSize: {package['size']}\nSHA256: {package['sha256']}\n")
            index = binary / 'Packages'
            index.write_text('\n'.join(paragraphs))
            # APT readers that fetched an earlier InRelease keep using its immutable hash.
            # Keep prior by-hash entries reachable across the atomic channel switch.
            by_hash = binary / 'by-hash/SHA256'
            if current.exists():
                shutil.copytree(current / 'main/binary-amd64/by-hash', binary / 'by-hash')
            by_hash.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(index, by_hash / digest(index))
            shutil.copyfile(destination / 'release.json', staging / 'release.json')
            now = datetime.now(timezone.utc)
            metadata = f"Origin: Couch\nLabel: Couch\nSuite: {channel}\nCodename: {channel}\nArchitectures: amd64\nComponents: main\nAcquire-By-Hash: yes\nDate: {format_datetime(now, usegmt=True)}\nValid-Until: {format_datetime(now + timedelta(days=7), usegmt=True)}\nSHA256:\n"
            for name in ['main/binary-amd64/Packages', 'release.json']:
                path = staging / name
                metadata += f' {digest(path)} {path.stat().st_size} {name}\n'
            (staging / 'Release').write_text(metadata)
            run('gpg', '--batch', '--yes', '--local-user', key, '--digest-algo', 'SHA256', '--clearsign', '--output', str(staging / 'InRelease'), str(staging / 'Release'))
            run('gpg', '--batch', '--verify', str(staging / 'InRelease'))
            # No advertised path changes until packages, indexes and signature all exist.
            link = dists / f'.{channel}-{os.getpid()}'
            try:
                link.symlink_to(os.path.relpath(staging, dists))
                os.replace(link, current)
                committed = True
                if channel == 'preview':
                    (history / identity).write_text(digest(destination / 'release.json'))
            finally:
                link.unlink(missing_ok=True)
        finally:
            if not committed:
                shutil.rmtree(staging)
        print(f'{channel}: {identity} ({manifest["build"]["version"]})')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifact', type=Path)
    parser.add_argument('feed', type=Path)
    parser.add_argument('channel', choices=['preview', 'stable'])
    parser.add_argument('--key', required=True, help='Existing repository signing key fingerprint')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Fa-f0-9]{40,64}', args.key):
        parser.error('--key must be a full signing key fingerprint')
    publish(args.artifact.resolve(), args.feed.resolve(), args.channel, args.key)
