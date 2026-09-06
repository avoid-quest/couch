#!/usr/bin/env python3
"""Disposable-key integration proof. Never use this key for an installation."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-release.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class Publication(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix='couch-feed-test-')
        cls.root = Path(cls.scratch.name)
        os.environ['GNUPGHOME'] = str(cls.root / 'keys')
        Path(os.environ['GNUPGHOME']).mkdir(mode=0o700)
        publisher.run('gpg', '--batch', '--passphrase', '', '--quick-generate-key', 'Couch disposable fixture', 'ed25519', 'sign', '1d')
        cls.key = next(line.split(':')[9] for line in publisher.run('gpg', '--with-colons', '--list-secret-keys').splitlines() if line.startswith('fpr:'))
        cls.artifacts = [cls.artifact(n) for n in [1, 2, 3, 4, 5]]
        cls.feed = cls.root / 'feed'
        cls.public_key = cls.root / 'fixture.asc'
        cls.public_key.write_text(publisher.run('gpg', '--armor', '--export', cls.key) + '\n')

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    @classmethod
    def artifact(cls, number):
        artifact = cls.root / f'artifact-{number}'
        artifact.mkdir()
        version = f'0.1.0+build.{number}.1'
        packages = []
        for name, arch in [('couch', 'amd64'), ('couch-appliance', 'all')]:
            stage = cls.root / f'{name}-{number}'
            (stage / 'DEBIAN').mkdir(parents=True)
            (stage / 'DEBIAN/control').write_text(f'Package: {name}\nVersion: {version}\nArchitecture: {arch}\nMaintainer: Fixture <fixture@example.invalid>\nDescription: Disposable release fixture\n')
            filename = f'{name}_{version}_{arch}.deb'
            path = artifact / filename
            publisher.run('dpkg-deb', '--build', str(stage), str(path))
            packages.append(dict(name=name, version=version, architecture=arch, filename=filename, size=path.stat().st_size, sha256=publisher.digest(path)))
        manifest = dict(schemaVersion=1, releaseId=f'{number}.1', build=dict(version=version, dirty=False, packaged=True, target='x86_64-unknown-linux-gnu', revision=str(number)*40), ci=dict(ref='main', repository='avoid-quest/couch', workflow='Package', runId=str(number), attempt='1'), qualification=dict(checks=['Disposable Debian fixture']), releaseNotes='Fixture only', packages=packages)
        (artifact / 'release.json').write_text(json.dumps(manifest))
        return artifact

    def test_publication_and_authenticated_apt(self):
        first, second, third, fourth, fifth = self.artifacts
        with self.assertRaises(ValueError):
            publisher.publish(first, self.feed, 'stable', self.key)
        publisher.publish(first, self.feed, 'preview', self.key)
        old_index = (self.feed / 'dists/preview/main/binary-amd64/Packages').read_bytes()
        old_hash = hashlib.sha256(old_index).hexdigest()
        publisher.publish(first, self.feed, 'stable', self.key)
        first_hashes = [publisher.digest(p) for p in (self.feed / 'releases/1.1').glob('*.deb')]
        # Install from APT with the separately enrolled key, never trusted=yes.
        lists = self.root / 'lists'
        lists.mkdir()
        sources = self.root / 'couch.list'
        sources.write_text(f'deb [arch=amd64 signed-by={self.public_key}] file:{self.feed} preview main\n')
        options = ['-o', f'Dir::Etc::sourcelist={sources}', '-o', 'Dir::Etc::sourceparts=-', '-o', f'Dir::State::lists={lists}', '-o', 'APT::Sandbox::User=root']
        publisher.run('apt-get', *options, 'update')
        publisher.run('apt-get', *options, 'install', '-y', '--no-install-recommends', 'couch=0.1.0+build.1.1', 'couch-appliance=0.1.0+build.1.1')
        publisher.publish(second, self.feed, 'preview', self.key)
        self.assertEqual((self.feed / f'dists/preview/main/binary-amd64/by-hash/SHA256/{old_hash}').read_bytes(), old_index)
        publisher.run('apt-get', *options, 'update')
        publisher.run('apt-get', *options, 'install', '-y', '--no-install-recommends', 'couch=0.1.0+build.2.1', 'couch-appliance=0.1.0+build.2.1')
        self.assertEqual(publisher.run('dpkg-query', '-W', '-f=${Version}', 'couch'), '0.1.0+build.2.1')
        with self.assertRaises(ValueError):
            publisher.publish(first, self.feed, 'preview', self.key)
        publisher.publish(second, self.feed, 'stable', self.key)
        self.assertEqual(first_hashes, [publisher.digest(p) for p in (self.feed / 'releases/1.1').glob('*.deb')])
        self.assertEqual((self.feed / 'dists/stable/release.json').read_bytes(), (second / 'release.json').read_bytes())
        old_link = os.readlink(self.feed / 'dists/preview')
        with self.assertRaises(subprocess.CalledProcessError):
            publisher.publish(third, self.feed, 'preview', 'F'*40)
        self.assertEqual(os.readlink(self.feed / 'dists/preview'), old_link)
        processes = [subprocess.Popen(['python3', str(Path(__file__).with_name('publish-release.py')), str(artifact), str(self.feed), 'preview', '--key', self.key], stdout=subprocess.PIPE, stderr=subprocess.PIPE) for artifact in [fourth, fifth]]
        results = [process.communicate(timeout=30) for process in processes]
        self.assertEqual(processes[1].returncode, 0, results[1])
        self.assertEqual(json.loads((self.feed / 'dists/preview/release.json').read_text())['releaseId'], '5.1')
        package = next(second.glob('*.deb'))
        package.write_bytes(package.read_bytes() + b'tampered')
        with self.assertRaises(ValueError):
            publisher.publish(second, self.feed, 'stable', self.key)
        # Signature tampering is rejected by APT and leaves the installed app unchanged.
        signed = self.feed / 'dists/preview/InRelease'
        signed.write_text(signed.read_text().replace('Origin: Couch', 'Origin: Tampered'))
        result = subprocess.run(['apt-get', *options, '-o', 'APT::Update::Error-Mode=any', 'update'], capture_output=True)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertEqual(publisher.run('dpkg-query', '-W', '-f=${Version}', 'couch'), '0.1.0+build.2.1')
        # Exercise installer enrollment while replacing service/APT commands only.
        # The real authenticated APT installs above remain separate evidence.
        commands = self.root / 'commands'
        commands.mkdir()
        for name, code in [('systemctl', 0), ('apt-get', 73)]:
            command = commands / name
            command.write_text(f'#!/bin/sh\nexit {code}\n')
            command.chmod(0o755)
        Path('/run/systemd/system').mkdir(parents=True, exist_ok=True)
        installer = Path(__file__).resolve().parent.parent / 'install-couch'
        arguments = ['bash', str(installer), str(next(first.glob('couch_*.deb'))), str(next(first.glob('couch-appliance_*.deb'))), '--release-key', str(self.public_key), '--release-key-sha256', publisher.digest(self.public_key), '--release-feed', 'http://127.0.0.1:8765/', '--release-channel', 'preview']
        environment = dict(os.environ, PATH=f'{commands}:' + os.environ['PATH'])
        result = subprocess.run(arguments, env=environment, capture_output=True)
        self.assertEqual(result.returncode, 73, result.stderr)
        self.assertEqual(Path('/etc/apt/keyrings/couch.asc').read_bytes(), self.public_key.read_bytes())
        self.assertIn('Signed-By: /etc/apt/keyrings/couch.asc', Path('/etc/apt/sources.list.d/couch.sources').read_text())
        arguments[arguments.index('--release-key-sha256') + 1] = '0'*64
        result = subprocess.run(arguments, env=environment, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'Release key SHA256 mismatch', result.stderr)
        print('PASS: two signed fixture installs, exact-byte Stable promotion, downgrade/tamper/signing-failure rejection, and old by-hash retention')


if __name__ == '__main__':
    unittest.main()
