#!/usr/bin/env python3
"""Prepare disposable signed inputs for test-update-feed.ts. Never enroll these keys."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys

spec = importlib.util.spec_from_file_location('fixtures', Path(__file__).with_name('test-publish-release.py'))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
f = fixtures.Publication
f.setUpClass()
try:
    for artifact in f.artifacts:
        path = artifact / 'release.json'
        manifest = json.loads(path.read_text())
        manifest['compatibility'] = dict(os='ubuntu', osVersion='24.04', architecture='amd64')
        path.write_text(json.dumps(manifest))
    fixtures.publisher.publish(f.artifacts[1], f.feed, 'preview', f.key)
    release = (f.feed / 'dists/preview/Release').read_text()
    lines = [line if not line.startswith('Valid-Until:') else 'Valid-Until: Sat, 01 Jan 2000 00:00:00 GMT' for line in release.splitlines()]
    expired = f.root / 'expired.Release'
    expired.write_text('\n'.join(lines) + '\n')
    fixtures.publisher.run('gpg', '--batch', '--yes', '--local-user', f.key, '--digest-algo', 'SHA256', '--clearsign', '--output', str(f.root / 'expired.InRelease'), str(expired))
    output = Path(sys.argv[1])
    output.mkdir()
    shutil.copytree(f.feed, output / 'feed', symlinks=True)
    for name in ['fixture.asc', 'expired.InRelease']:
        shutil.copyfile(f.root / name, output / name)
finally:
    f.tearDownClass()
