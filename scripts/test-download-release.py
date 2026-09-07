import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('downloader', Path(__file__).with_name('download-release.py'))
downloader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(downloader)


class Download(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.destination = Path(self.directory.name) / 'release'
        self.manifest = dict(releaseId='42.2', build=dict(revision='a'*40), ci=dict(runId='42', attempt='2', ref='main', repository='avoid-quest/couch', workflow='Package'), packages=[dict(filename='couch.deb', size=4, sha256=hashlib.sha256(b'test').hexdigest())])
        self.run = dict(id=42, run_attempt=2, event='push', conclusion='success', head_branch='main', path='.github/workflows/package.yml', head_sha='a'*40, repository=dict(full_name='avoid-quest/couch'), head_repository=dict(full_name='avoid-quest/couch'))

    def tearDown(self):
        self.directory.cleanup()

    def responses(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as zipped:
            zipped.writestr('release.json', json.dumps(self.manifest))
            zipped.writestr('couch.deb', b'test')
        raw = archive.getvalue()
        artifact = dict(expired=False, name='couch-release-42.2', workflow_run=dict(id=42, head_sha='a'*40), digest='sha256:' + hashlib.sha256(raw).hexdigest())
        return {'actions/artifacts/123': json.dumps(artifact).encode(), 'actions/runs/42': json.dumps(self.run).encode(), 'actions/artifacts/123/zip': raw}

    def test_exact_authenticated_attempt_downloads(self):
        with patch.object(downloader, 'api', side_effect=self.responses().__getitem__):
            downloader.download(123, self.destination)
        self.assertEqual((self.destination / 'couch.deb').read_bytes(), b'test')

    def test_successful_retry_reuses_an_earlier_build(self):
        self.run['run_attempt'] = 3
        with patch.object(downloader, 'api', side_effect=self.responses().__getitem__):
            downloader.download(123, self.destination)
        self.assertTrue(self.destination.exists())

    def test_failed_retry_does_not_qualify_an_earlier_build(self):
        self.run.update(run_attempt=3, conclusion='failure')
        with patch.object(downloader, 'api', side_effect=self.responses().__getitem__):
            with self.assertRaises(ValueError):
                downloader.download(123, self.destination)

    def test_fork_main_pull_request_is_rejected_before_download(self):
        self.run.update(event='pull_request', head_repository=dict(full_name='fixture-fork/couch'))
        with patch.object(downloader, 'api', side_effect=self.responses().__getitem__) as api:
            with self.assertRaises(ValueError):
                downloader.download(123, self.destination)
            self.assertEqual(api.call_count, 2)
        self.assertFalse(self.destination.exists())

    def test_run_event_origin_and_attempt_must_match(self):
        original = copy.deepcopy(self.run)
        for change in [dict(event='pull_request'), dict(head_repository=dict(full_name='fixture-fork/couch')), dict(run_attempt=1), dict(head_branch='topic')]:
            self.run = dict(original, **change)
            with patch.object(downloader, 'api', side_effect=self.responses().__getitem__):
                with self.assertRaises(ValueError):
                    downloader.download(123, self.destination)

    def test_forged_manifest_attempt_and_ref_are_rejected(self):
        for field, value in [('attempt', '3'), ('ref', 'topic')]:
            original = self.manifest['ci'][field]
            self.manifest['ci'][field] = value
            with patch.object(downloader, 'api', side_effect=self.responses().__getitem__):
                with self.assertRaises(ValueError):
                    downloader.download(123, self.destination)
            self.manifest['ci'][field] = original


if __name__ == '__main__':
    unittest.main()
