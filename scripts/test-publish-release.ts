/** Disposable Ubuntu integration test: installs dummy packages, never run on an appliance. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { digest, run } from './publish-release';

assert.equal(process.getuid?.(), 0, 'Run only as root in a disposable Ubuntu environment');
const root = mkdtempSync(join(tmpdir(), 'couch-feed-test-'));
const previousHome = process.env.GNUPGHOME;
process.env.GNUPGHOME = join(root, 'keys');
mkdirSync(process.env.GNUPGHOME, { mode: 0o700 });
try {
  run('gpg', '--batch', '--passphrase', '', '--quick-generate-key', 'Couch disposable fixture', 'ed25519', 'sign', '1d');
  const key = run('gpg', '--with-colons', '--list-secret-keys').split('\n').find(line => line.startsWith('fpr:'))!.split(':')[9]!;
  const artifacts = [1, 2, 3, 4, 5].map(number => {
    const artifact = join(root, `artifact-${number}`);
    mkdirSync(artifact);
    const version = `0.1.0+build.${number}.1`;
    const packages = [['couch', 'amd64'], ['couch-appliance', 'all']].map(([name, architecture]) => {
      const stage = join(root, `${name}-${number}`);
      mkdirSync(join(stage, 'DEBIAN'), { recursive: true });
      writeFileSync(join(stage, 'DEBIAN/control'), `Package: ${name}\nVersion: ${version}\nArchitecture: ${architecture}\nMaintainer: Fixture <fixture@example.invalid>\nDescription: Disposable release fixture\n`);
      const filename = `${name}_${version}_${architecture}.deb`;
      run('dpkg-deb', '--build', stage, join(artifact, filename));
      return { name, architecture, version, filename, size: readFileSync(join(artifact, filename)).length, sha256: digest(join(artifact, filename)) };
    });
    writeFileSync(join(artifact, 'release.json'), JSON.stringify({ schemaVersion: 1, releaseId: `${number}.1`, build: { version, dirty: false, packaged: true, target: 'x86_64-unknown-linux-gnu', revision: String(number).repeat(40) }, ci: { ref: 'main', repository: 'avoid-quest/couch', workflow: 'Package', runId: String(number), attempt: '1' }, qualification: { checks: ['Disposable Debian fixture'] }, releaseNotes: 'Fixture only', packages }));
    return artifact;
  });
  const [first, second, third, fourth, fifth] = artifacts as [string, string, string, string, string];
  const feed = join(root, 'feed');
  const command = (artifact: string, channel = 'preview', fingerprint = key) => [resolve(import.meta.dir, 'publish-release.ts'), artifact, feed, channel, '--key', fingerprint];
  const publish = (artifact: string, channel = 'preview', fingerprint = key) => run(process.execPath, ...command(artifact, channel, fingerprint));
  assert.throws(() => publish(first, 'stable'));
  publish(first);
  const oldIndex = readFileSync(join(feed, 'dists/preview/main/binary-amd64/Packages'));
  const oldHash = digest(join(feed, 'dists/preview/main/binary-amd64/Packages'));
  publish(first, 'stable');
  const firstManifestHash = digest(join(feed, 'releases/1.1/release.json'));
  const publicKey = join(root, 'fixture.asc');
  writeFileSync(publicKey, run('gpg', '--armor', '--export', key) + '\n');
  const lists = join(root, 'lists');
  mkdirSync(lists);
  const sources = join(root, 'couch.list');
  writeFileSync(sources, `deb [arch=amd64 signed-by=${publicKey}] file:${feed} preview main\n`);
  const options = ['-o', `Dir::Etc::sourcelist=${sources}`, '-o', 'Dir::Etc::sourceparts=-', '-o', `Dir::State::lists=${lists}`, '-o', 'APT::Sandbox::User=root'];
  for (const number of [1, 2]) {
    if (number === 2) publish(second);
    run('apt-get', ...options, 'update');
    run('apt-get', ...options, 'install', '-y', '--no-install-recommends', `couch=0.1.0+build.${number}.1`, `couch-appliance=0.1.0+build.${number}.1`);
  }
  assert.deepEqual(readFileSync(join(feed, `dists/preview/main/binary-amd64/by-hash/SHA256/${oldHash}`)), oldIndex);
  assert.equal(run('dpkg-query', '-W', '-f=${Version}', 'couch'), '0.1.0+build.2.1');
  assert.throws(() => publish(first));
  publish(second, 'stable');
  assert.equal(digest(join(feed, 'releases/1.1/release.json')), firstManifestHash);
  assert.deepEqual(readFileSync(join(feed, 'dists/stable/release.json')), readFileSync(join(second, 'release.json')));
  const oldLink = readlinkSync(join(feed, 'dists/preview'));
  assert.throws(() => publish(third, 'preview', 'F'.repeat(40)));
  assert.equal(readlinkSync(join(feed, 'dists/preview')), oldLink);
  const results = await Promise.all([fourth, fifth].map(artifact => new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, command(artifact), { stdio: 'pipe' });
    child.on('error', reject); child.on('exit', resolve);
  })));
  assert.equal(results[1], 0);
  assert.equal(JSON.parse(readFileSync(join(feed, 'dists/preview/release.json'), 'utf8')).releaseId, '5.1');
  const tamperedPackage = join(second, 'couch_0.1.0+build.2.1_amd64.deb');
  writeFileSync(tamperedPackage, Buffer.concat([readFileSync(tamperedPackage), Buffer.from('tampered')]));
  assert.throws(() => publish(second, 'stable'));
  const signed = join(feed, 'dists/preview/InRelease');
  writeFileSync(signed, readFileSync(signed, 'utf8').replace('Origin: Couch', 'Origin: Tampered'));
  assert.notEqual(spawnSync('apt-get', [...options, '-o', 'APT::Update::Error-Mode=any', 'update']).status, 0);
  assert.equal(run('dpkg-query', '-W', '-f=${Version}', 'couch'), '0.1.0+build.2.1');
  const commands = join(root, 'commands');
  mkdirSync(commands);
  for (const [name, code] of [['systemctl', 0], ['apt-get', 73]] as const) {
    writeFileSync(join(commands, name), `#!/bin/sh\nexit ${code}\n`); chmodSync(join(commands, name), 0o755);
  }
  mkdirSync('/run/systemd/system', { recursive: true });
  const args = [resolve(import.meta.dir, '../install-couch'), join(first, 'couch_0.1.0+build.1.1_amd64.deb'), join(first, 'couch-appliance_0.1.0+build.1.1_all.deb'), '--release-key', publicKey, '--release-key-sha256', digest(publicKey), '--release-feed', 'http://127.0.0.1:8765/', '--release-channel', 'preview'];
  const env = { ...process.env, PATH: `${commands}:${process.env.PATH}` };
  assert.equal(spawnSync('bash', args, { env }).status, 73);
  assert.deepEqual(readFileSync('/etc/apt/keyrings/couch.asc'), readFileSync(publicKey));
  assert.match(readFileSync('/etc/apt/sources.list.d/couch.sources', 'utf8'), /Signed-By: \/etc\/apt\/keyrings\/couch.asc/);
  args[args.indexOf('--release-key-sha256') + 1] = '0'.repeat(64);
  const rejected = spawnSync('bash', args, { env });
  assert.notEqual(rejected.status, 0); assert.match(rejected.stderr.toString(), /Release key SHA256 mismatch/);
  console.log('PASS: authenticated APT install/upgrade, immutable Stable promotion, concurrent publication, downgrade/tamper/signing-failure rejection, by-hash retention and installer key enrollment');
} finally {
  run('gpgconf', '--kill', 'gpg-agent');
  process.env.GNUPGHOME = previousHome;
  rmSync(root, { recursive: true, force: true });
}
