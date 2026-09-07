import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { download, verifiedArchive } from './download-release';

const scratch: string[] = [];
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'couch-download-test-'));
  scratch.push(root);
  const destination = join(root, 'downloaded');
  const hash = (value: Uint8Array) => new Bun.CryptoHasher('sha256').update(value).digest('hex');
  const manifest = { releaseId: '42.2', build: { revision: 'a'.repeat(40) }, ci: { runId: '42', attempt: '2', ref: 'main', repository: 'avoid-quest/couch', workflow: 'Package' }, packages: [{ filename: 'couch.deb', size: 4, sha256: hash(Buffer.from('test')) }] };
  const run = { id: 42, run_attempt: 2, event: 'push', conclusion: 'success', head_branch: 'main', path: '.github/workflows/package.yml', head_sha: 'a'.repeat(40), repository: { full_name: 'avoid-quest/couch' }, head_repository: { full_name: 'avoid-quest/couch' } };
  const artifact = { expired: false, name: 'couch-release-42.2', workflow_run: { id: 42, head_sha: run.head_sha }, digest: '' };
  const request = (path: string) => {
    if (path === 'actions/runs/42') return Buffer.from(JSON.stringify(run));
    writeFileSync(join(root, 'release.json'), JSON.stringify(manifest));
    writeFileSync(join(root, 'couch.deb'), 'test');
    rmSync(join(root, 'artifact.zip'), { force: true });
    execFileSync('zip', ['-q', 'artifact.zip', 'release.json', 'couch.deb'], { cwd: root });
    const zip = readFileSync(join(root, 'artifact.zip'));
    if (path.endsWith('/zip')) return zip;
    return Buffer.from(JSON.stringify({ ...artifact, digest: artifact.digest || `sha256:${hash(zip)}` }));
  };
  return { root, destination, manifest, run, artifact, request };
}

test('exact authenticated artifact and successful retry reuse original build', () => {
  const f = fixture(); f.run.run_attempt = 3;
  download('123', f.destination, f.request);
  expect(readFileSync(join(f.destination, 'couch.deb'), 'utf8')).toBe('test');
  expect(() => download('123', f.destination, f.request)).toThrow();
});
test('reject untrusted run origin, failure and impossible build attempt before download', () => {
  for (const change of [{ conclusion: 'failure' }, { event: 'pull_request' }, { head_branch: 'topic' }, { run_attempt: 1 }, { head_repository: { full_name: 'fork/couch' } }]) {
    const f = fixture(); Object.assign(f.run, change);
    expect(() => download('123', f.destination, f.request)).toThrow();
    expect(existsSync(f.destination)).toBe(false);
  }
});
test('reject forged manifest identity and package bytes', () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => { f.manifest.ci.attempt = '3'; }, (f: ReturnType<typeof fixture>) => { f.manifest.ci.ref = 'topic'; }, (f: ReturnType<typeof fixture>) => { f.manifest.packages[0]!.sha256 = '0'.repeat(64); }]) {
    const f = fixture(); mutate(f);
    expect(() => download('123', f.destination, f.request)).toThrow();
    expect(existsSync(f.destination)).toBe(false);
  }
});
test('reject expired or digest-tampered GitHub archive', () => {
  for (const change of [{ expired: true }, { digest: `sha256:${'0'.repeat(64)}` }]) {
    const f = fixture(); Object.assign(f.artifact, change);
    expect(() => verifiedArchive('123', 'couch-release', f.request)).toThrow();
  }
});
test('shared verifier explicitly accepts AppImage prefix without weakening source policy', () => {
  const f = fixture(); f.artifact.name = 'couch-appimage-42.2';
  expect(verifiedArchive('123', 'couch-appimage', f.request).identity).toBe('42.2');
  expect(() => verifiedArchive('123', 'couch-release', f.request)).toThrow();
});
