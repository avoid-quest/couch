#!/usr/bin/env python3
"""Real signature/archive checks. Run only in a disposable Ubuntu tools container."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("fixtures", Path(__file__).with_name("test-update-retention.py"))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
from receipt import Rejected, copy_receipt
from retention import Retention


def run(*args):
    return subprocess.check_output(args, stderr=subprocess.DEVNULL)


class UbuntuReceipt(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="couch-receipt-proof-")
        cls.root = Path(cls.temporary.name)
        cls.keys = cls.root / "keys"
        cls.keys.mkdir(mode=0o700)
        run("gpg", "--homedir", str(cls.keys), "--batch", "--passphrase", "", "--quick-generate-key", "Couch disposable updater fixture", "ed25519", "sign", "1d")
        cls.key = run("gpg", "--homedir", str(cls.keys), "--armor", "--export")

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def setUp(self):
        self.work = Path(tempfile.mkdtemp(dir=self.root))
        self.source = self.work / "source"
        self.manifest = fixtures.fixture(self.source)
        for package in self.manifest["packages"]:
            stage = self.work / package["name"]
            (stage / "DEBIAN").mkdir(parents=True)
            (stage / "DEBIAN/control").write_text(f'Package: {package["name"]}\nVersion: {package["version"]}\nArchitecture: {package["architecture"]}\nMaintainer: Fixture <fixture@example.invalid>\nDescription: Disposable updater receipt\n')
            path = self.source / package["filename"]
            run("dpkg-deb", "--root-owner-group", "--build", str(stage), str(path))
            package.update(size=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        (self.source / "release.json").write_text(json.dumps(self.manifest))
        (self.source / "Packages").write_text("\n".join(f'Package: {p["name"]}\nVersion: {p["version"]}\nArchitecture: {p["architecture"]}\nFilename: releases/1.1/{p["filename"]}\nSize: {p["size"]}\nSHA256: {p["sha256"]}\n' for p in self.manifest["packages"]))
        metadata = json.loads((self.source / "InRelease").read_bytes())
        metadata["SHA256"] = "\n" + "\n".join(f" {hashlib.sha256((self.source / path).read_bytes()).hexdigest()} {(self.source / path).stat().st_size} {name}" for path, name in (("release.json", "release.json"), ("Packages", "main/binary-amd64/Packages")))
        release = self.work / "Release"
        release.write_text("\n".join(f"{key}: {value}" for key, value in metadata.items()) + "\n")
        run("gpg", "--homedir", str(self.keys), "--batch", "--yes", "--digest-algo", "SHA256", "--clearsign", "--output", str(self.source / "InRelease"), str(release))
        self.destination = self.work / "copied"
        self.destination.mkdir()

    def test_real_signature_and_debian_archives(self):
        _, manifest = copy_receipt(self.source, self.destination, self.key)
        self.assertEqual(manifest, self.manifest)
        storage = Retention(self.work / "state")
        record = storage.enroll(self.source, self.key, self.manifest["build"])
        self.assertEqual(storage.current(self.key), record)

    def test_real_signature_rejects_modified_signed_metadata(self):
        signed = self.source / "InRelease"
        signed.write_bytes(signed.read_bytes().replace(b"Origin: Couch", b"Origin: Bouch"))
        with self.assertRaises(Rejected):
            copy_receipt(self.source, self.destination, self.key)
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_real_archive_tamper_is_rejected(self):
        package = self.source / self.manifest["packages"][0]["filename"]
        data = package.read_bytes()
        package.write_bytes(data[:-1] + bytes([data[-1] ^ 1]))
        with self.assertRaisesRegex(Rejected, "failed authentication"):
            copy_receipt(self.source, self.destination, self.key)


if __name__ == "__main__":
    unittest.main()
