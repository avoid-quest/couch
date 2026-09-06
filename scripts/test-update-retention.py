#!/usr/bin/env python3
"""Receipt and retention tests. No service, package manager or target mutations."""
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "packaging/appliance/root/usr/lib/couch-appliance/updater"))
import receipt
import retention
from retention import Retention, require_format, save


def fixture(directory, number=1):
    directory.mkdir()
    version = f"0.1.0+build.{number}.1"
    packages, paragraphs = [], []
    for name, architecture in (("couch", "amd64"), ("couch-appliance", "all")):
        filename = f"{name}_{version}_{architecture}.deb"
        data = json.dumps({"Package": name, "Version": version, "Architecture": architecture}).encode()
        (directory / filename).write_bytes(data)
        package = {"name": name, "version": version, "architecture": architecture, "filename": filename, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        packages.append(package)
        paragraphs.append(f"Package: {name}\nVersion: {version}\nArchitecture: {architecture}\nFilename: releases/{number}.1/{filename}\nSize: {len(data)}\nSHA256: {package['sha256']}\n")
    manifest = {"schemaVersion": 1, "releaseId": f"{number}.1", "build": {"version": version, "revision": str(number) * 40, "packaged": True, "dirty": False, "target": "x86_64-unknown-linux-gnu", "dataFormat": 1}, "ci": {"ref": "main", "repository": "avoid-quest/couch", "workflow": "Package", "runId": str(number), "attempt": "1"}, "compatibility": {"os": "ubuntu", "osVersion": "24.04", "architecture": "amd64", "dataFormat": 1}, "qualification": {"checks": ["fixture"]}, "releaseNotes": "Fixture only", "packages": packages}
    (directory / "release.json").write_text(json.dumps(manifest))
    (directory / "Packages").write_text("\n".join(paragraphs))
    now = datetime.now(timezone.utc)
    metadata = {"Origin": "Couch", "Suite": "preview", "Codename": "preview", "Architectures": "amd64", "Components": "main", "Date": format_datetime(now - timedelta(seconds=5)), "Valid-Until": format_datetime(now + timedelta(days=1))}
    metadata["SHA256"] = "\n".join(f" {hashlib.sha256((directory / path).read_bytes()).hexdigest()} {(directory / path).stat().st_size} {name}" for path, name in (("release.json", "release.json"), ("Packages", "main/binary-amd64/Packages")))
    (directory / "InRelease").write_text(json.dumps(metadata))
    return manifest


def fake_control(*args, **kwargs):
    value = json.loads(Path(args[-1]).read_bytes())
    return "\n".join(f"{key}: {value}" for key, value in value.items()).encode()


class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        self.manifest = fixture(self.source)
        self.destination = self.root / "output"
        self.destination.mkdir()
        self.addCleanup(patch.stopall)
        patch.object(receipt, "signed_fields", side_effect=lambda data, key: json.loads(data)).start()
        patch.object(receipt, "run", side_effect=fake_control).start()

    def copy(self, **options):
        return receipt.copy_receipt(self.source, self.destination, b"fixture", **options)

    def test_verified_bytes_are_retained_independently(self):
        candidate_id, manifest = self.copy()
        self.assertEqual(candidate_id, hashlib.sha256((self.source / "release.json").read_bytes()).hexdigest())
        self.assertEqual(manifest, self.manifest)
        package = manifest["packages"][0]["filename"]
        original = (self.destination / package).read_bytes()
        (self.source / package).write_bytes(b"replacement")
        self.assertEqual((self.destination / package).read_bytes(), original)

    def test_candidate_digest_must_match(self):
        with self.assertRaisesRegex(receipt.Rejected, "identity changed"):
            self.copy(expected="0" * 64)

    def test_package_tampering_is_rejected(self):
        path = self.source / self.manifest["packages"][0]["filename"]
        path.write_bytes(b"x" * path.stat().st_size)
        with self.assertRaisesRegex(receipt.Rejected, "failed authentication"):
            self.copy()

    def test_receipt_and_package_symlinks_are_rejected(self):
        for name in ("release.json", self.manifest["packages"][0]["filename"]):
            with self.subTest(name=name):
                path = self.source / name
                original = path.read_bytes()
                target = self.root / "target"
                target.write_bytes(original)
                path.unlink()
                path.symlink_to(target)
                with self.assertRaises(receipt.Rejected):
                    self.copy()
                path.unlink()
                path.write_bytes(original)
                shutil.rmtree(self.destination)
                self.destination.mkdir()

    def test_parent_directory_replacement_does_not_change_pinned_receipt(self):
        def replace(data, key):
            self.source.rename(self.root / "original")
            fixture(self.source, 2)
            return json.loads(data)
        receipt.signed_fields.side_effect = replace
        _, manifest = self.copy()
        self.assertEqual(manifest["build"]["version"], "0.1.0+build.1.1")

    def test_archive_control_identity_must_match(self):
        receipt.run.side_effect = lambda *args, **kwargs: b"Package: another\nVersion: 1\nArchitecture: all"
        with self.assertRaisesRegex(receipt.Rejected, "unexpected package identity"):
            self.copy()

    def test_expiry_exception_is_only_for_retaining_current(self):
        metadata = json.loads((self.source / "InRelease").read_bytes())
        metadata["Date"] = format_datetime(datetime.now(timezone.utc) - timedelta(days=2))
        metadata["Valid-Until"] = format_datetime(datetime.now(timezone.utc) - timedelta(days=1))
        (self.source / "InRelease").write_text(json.dumps(metadata))
        with self.assertRaisesRegex(receipt.Rejected, "dates or content hashes"):
            self.copy()
        self.copy(fresh=False)

    def test_signed_hash_and_repeated_fields_are_rejected(self):
        (self.source / "Packages").write_bytes(b"changed")
        with self.assertRaisesRegex(receipt.Rejected, "content hashes"):
            self.copy()
        with self.assertRaises(receipt.Rejected):
            receipt.fields("Origin: Couch\nOrigin: another")
        with self.assertRaises(receipt.Rejected):
            receipt.load_json('{"version":1,"version":2}')

    def test_signature_failure_precedes_package_access(self):
        receipt.signed_fields.side_effect = receipt.Rejected("Invalid signature")
        with self.assertRaisesRegex(receipt.Rejected, "Invalid signature"):
            self.copy()
        receipt.run.assert_not_called()

    def test_format_must_be_explicit_supported_and_consistent(self):
        require_format(self.manifest, {"dataFormat": 1})
        for value in (None, True, 2, "1"):
            with self.subTest(value=value):
                self.manifest["compatibility"]["dataFormat"] = value
                with self.assertRaises(receipt.Rejected):
                    require_format(self.manifest, {"dataFormat": 1})

    def test_fifo_cannot_block_verification(self):
        path = self.source / "InRelease"
        path.unlink()
        os.mkfifo(path)
        with self.assertRaisesRegex(receipt.Rejected, "unsupported type"):
            self.copy()

    def test_space_refusal_precedes_receipt_writes(self):
        needed = sum(p["size"] for p in self.manifest["packages"]) + sum((self.source / name).stat().st_size for name in ("InRelease", "release.json", "Packages")) + receipt.RESERVE
        with patch.object(receipt.shutil, "disk_usage", return_value=shutil._ntuple_diskusage(needed, 1, needed - 1)) as capacity:
            with self.assertRaisesRegex(receipt.Rejected, "more update storage"):
                self.copy()
            capacity.assert_called_once_with(self.destination)
        self.assertEqual(list(self.destination.iterdir()), [])
        receipt.run.assert_not_called()


class RetentionTests(unittest.TestCase):
    def setUp(self):
        ReceiptTests.setUp(self)
        self.storage = Retention(self.root / "state")

    def test_generic_enrollment_survives_reopening(self):
        first = self.storage.enroll(self.source, b"fixture", self.manifest["build"])
        reopened = Retention(self.root / "state")
        self.assertEqual(reopened.current(b"fixture"), first)
        second_source = self.root / "second"
        second = fixture(second_source, 2)
        result = reopened.enroll(second_source, b"fixture", second["build"])
        self.assertEqual(result["version"], "0.1.0+build.2.1")
        self.assertTrue((self.storage.receipts / first["candidateId"]).is_dir())

    def test_mismatched_installed_build_does_not_replace_current(self):
        first = self.storage.enroll(self.source, b"fixture", self.manifest["build"])
        with self.assertRaisesRegex(receipt.Rejected, "does not match"):
            self.storage.enroll(self.source, b"fixture", {**self.manifest["build"], "revision": "f" * 40})
        self.assertEqual(self.storage.current(b"fixture"), first)

    def test_corrupt_retained_package_is_never_trusted(self):
        current = self.storage.enroll(self.source, b"fixture", self.manifest["build"])
        (self.storage.receipts / current["candidateId"] / self.manifest["packages"][0]["filename"]).write_bytes(b"corrupt")
        with self.assertRaises(receipt.Rejected):
            self.storage.current(b"fixture")

    def test_an_active_transaction_prevents_reenrollment(self):
        save(self.storage.root / "active.json", {"updateId": "a" * 32})
        with self.assertRaisesRegex(receipt.Rejected, "Finish the current"):
            self.storage.enroll(self.source, b"fixture", self.manifest["build"])

    def test_only_one_retention_writer(self):
        with self.storage.lock(), self.assertRaisesRegex(receipt.Rejected, "Another Couch maintenance"):
            self.storage.enroll(self.source, b"fixture", self.manifest["build"])

    def test_fresh_renewal_replaces_expired_retained_signature(self):
        signed = self.source / "InRelease"
        fresh = signed.read_bytes()
        metadata = json.loads(fresh)
        metadata["Date"] = format_datetime(datetime.now(timezone.utc) - timedelta(days=2))
        metadata["Valid-Until"] = format_datetime(datetime.now(timezone.utc) - timedelta(days=1))
        signed.write_text(json.dumps(metadata))
        record = self.storage.enroll(self.source, b"fixture", self.manifest["build"])
        retained = self.storage.receipts / record["candidateId"]
        signed.write_bytes(fresh)
        self.storage.retain(self.source, b"fixture", fresh=True)
        self.assertEqual((retained / "InRelease").read_bytes(), fresh)
        output = self.root / "renewed"
        output.mkdir()
        receipt.copy_receipt(retained, output, b"fixture", fresh=True)

    def test_installed_identity_requires_both_configured_packages_and_matching_docs(self):
        build = self.manifest["build"]
        companion = {"package": "couch-appliance", "version": build["version"], "sourceCommit": build["revision"]}
        records = f'couch\t{build["version"]}\tamd64\tinstalled\ncouch-appliance\t{build["version"]}\tall\tinstalled\n'.encode()
        with patch.object(retention, "run", return_value=records) as query, patch.object(retention, "trusted_file", side_effect=lambda path: json.dumps(companion if "couch-appliance" in path else build).encode()):
            self.assertEqual(retention.installed(), build)
            companion["sourceCommit"] = "f" * 40
            with self.assertRaisesRegex(receipt.Rejected, "identities disagree"):
                retention.installed()
            companion["sourceCommit"] = build["revision"]
            query.return_value = records.replace(b"installed", b"unpacked", 1)
            with self.assertRaisesRegex(receipt.Rejected, "completely configured"):
                retention.installed()

    def test_current_verification_needs_no_extra_archive_copy(self):
        current = self.storage.enroll(self.source, b"fixture", self.manifest["build"])
        with patch.object(retention.tempfile, "mkdtemp", side_effect=AssertionError("No package copy needed")), patch.object(receipt.shutil, "disk_usage", side_effect=AssertionError("No new package allocation")):
            self.assertEqual(self.storage.current(b"fixture"), current)

    def test_capacity_failure_cleans_partial_directory_and_keeps_current(self):
        current = self.storage.enroll(self.source, b"fixture", self.manifest["build"])
        second = self.root / "second"
        fixture(second, 2)
        with patch.object(receipt.shutil, "disk_usage", return_value=shutil._ntuple_diskusage(100, 100, 0)), self.assertRaises(receipt.Rejected):
            self.storage.retain(second, b"fixture")
        self.assertFalse(list(self.storage.receipts.glob(".receipt-*")))
        self.assertEqual(self.storage.current(b"fixture"), current)


if __name__ == "__main__":
    unittest.main()
