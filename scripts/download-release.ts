#!/usr/bin/env bun
/** Download exact qualified private artifacts using the operator's gh login. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const repository = 'avoid-quest/couch';
const sha256 = (data: Uint8Array) => new Bun.CryptoHasher('sha256').update(data).digest('hex');
const api = (path: string) => execFileSync('gh', ['api', `repos/${repository}/${path}`], { maxBuffer: 1024 ** 3 });

export function verifiedArchive(artifactId: string, prefix: 'couch-release' | 'couch-appimage' = 'couch-release', request = api) {
  const artifact = JSON.parse(request(`actions/artifacts/${artifactId}`).toString());
  if (artifact.expired || !artifact.name.startsWith(`${prefix}-`) || !/^[1-9][0-9]*\.[1-9][0-9]*$/.test(artifact.name.slice(prefix.length + 1))) throw Error('Choose an unexpired immutable release artifact');
  const identity: string = artifact.name.slice(prefix.length + 1);
  const [runId, attempt] = identity.split('.');
  if (String(artifact.workflow_run.id) !== runId) throw Error('Artifact run identity mismatch');
  const run = JSON.parse(request(`actions/runs/${runId}`).toString());
  if (run.conclusion !== 'success' || !['push', 'workflow_dispatch'].includes(run.event)
    || run.head_branch !== 'main' || run.path !== '.github/workflows/package.yml'
    || run.repository.full_name !== repository || run.head_repository.full_name !== repository
    || String(run.id) !== runId || run.run_attempt < Number(attempt) || artifact.workflow_run.head_sha !== run.head_sha) {
    throw Error('Artifact must come from a successful main Package run in the source repository');
  }
  const archive = request(`actions/artifacts/${artifactId}/zip`);
  if (artifact.digest !== `sha256:${sha256(archive)}`) throw Error('GitHub artifact SHA256 mismatch or missing digest');
  return { identity, run, archive };
}

export function download(artifactId: string, destination: string, request = api) {
  const { identity, run, archive } = verifiedArchive(artifactId, "couch-release", request);
  const [runId, attempt] = identity.split(".");
  const scratch = mkdtempSync(join(tmpdir(), 'couch-download-'));
  try {
    const zip = join(scratch, 'artifact.zip');
    writeFileSync(zip, archive);
    const contents = (name: string) => execFileSync('unzip', ['-p', zip, name], { maxBuffer: 1024 ** 3 });
    const manifest = JSON.parse(contents('release.json').toString());
    const ci = manifest.ci;
    if (manifest.releaseId !== identity || manifest.build.revision !== run.head_sha
      || ci.runId !== runId || ci.attempt !== attempt || ci.ref !== 'main'
      || ci.repository !== repository || ci.workflow !== 'Package') throw Error('Artifact source/run identity mismatch');
    const names = ['release.json', ...manifest.packages.map((p: { filename: string }) => p.filename)];
    const listed = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trimEnd().split('\n');
    if (names.some(name => !/^[A-Za-z0-9_.+~-]+$/.test(name)) || new Set(names).size !== names.length
      || JSON.stringify(listed.sort()) !== JSON.stringify([...names].sort())) throw Error('Unexpected artifact files');
    const files = new Map(names.map(name => [name, contents(name)]));
    for (const p of manifest.packages) {
      const data = files.get(p.filename)!;
      if (data.length !== p.size || sha256(data) !== p.sha256) throw Error('Package SHA256 mismatch');
    }
    mkdirSync(dirname(destination), { recursive: true });
    mkdirSync(destination); // Never overwrite an existing downloaded release.
    for (const [name, data] of files) writeFileSync(join(destination, name), data);
    console.log(`Verified artifact ${artifactId}, release ${identity}, source ${run.head_sha}`);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (import.meta.main) {
  const [id, destination] = process.argv.slice(2);
  if (!id || !/^[1-9][0-9]*$/.test(id) || !destination || process.argv.length !== 4) throw Error('Usage: bun scripts/download-release.ts ARTIFACT_ID DESTINATION');
  download(id, destination);
}
