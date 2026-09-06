"""Authenticate a signed receipt independently of Couch's unprivileged stager."""
import base64
from contextlib import nullcontext
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile

LIMIT = 2 * 1024 * 1024
SHA = re.compile(r"[a-f0-9]{64}\Z")
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+\+build\.[1-9][0-9]*\.[1-9][0-9]*\Z")
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"}
RESERVE = 256 * 1024 * 1024


class Rejected(Exception):
    """A safe error that may be shown to an administrator remote."""


def run(*args, pass_fds=()):
    try:
        return subprocess.check_output(args, env=ENV, stderr=subprocess.DEVNULL, timeout=30, pass_fds=pass_fds)
    except (OSError, subprocess.SubprocessError) as error:
        raise Rejected("Release verification could not complete.") from error


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise Rejected("Release metadata contains a repeated field.")
        result[key] = value
    return result


def load_json(value):
    try:
        return json.loads(value, object_pairs_hook=unique)
    except (ValueError, TypeError) as error:
        raise Rejected("Release metadata is invalid.") from error


def fields(value):
    result, key = {}, None
    for line in value.strip().splitlines():
        if line.startswith((" ", "\t")) and key:
            result[key] += "\n" + line
            continue
        match = re.fullmatch(r"([A-Za-z][A-Za-z0-9-]*):\s*(.*)", line)
        if not match or match[1] in result:
            raise Rejected("Signed release fields are invalid or repeated.")
        key = match[1]
        result[key] = match[2]
    return result


def read_at(directory, name, limit=LIMIT):
    """Pin each regular input to a descriptor; never follow a receipt symlink."""
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise Rejected("A release file has an unsupported type or size.")
        value = stream.read(limit + 1)
        if len(value) > limit:
            raise Rejected("A release file exceeds its size limit.")
        return value


def trusted_file(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if info.st_uid != 0 or info.st_mode & 0o022 or not stat.S_ISREG(info.st_mode):
            raise Rejected("Release trust must be an administrator-owned regular file.")
        value = stream.read(LIMIT + 1)
        if len(value) > LIMIT:
            raise Rejected("Release trust configuration is too large.")
        return value


def enrolled_key():
    source = fields(trusted_file("/etc/apt/sources.list.d/couch.sources").decode())
    if source.get("Signed-By") != "/etc/apt/keyrings/couch.asc" or source.get("Types") != "deb" or source.get("Components") != "main" or source.get("Architectures") != "amd64" or source.get("Suites") not in ("stable", "preview"):
        raise Rejected("Enroll the signed Couch feed through the supported installer.")
    return trusted_file("/etc/apt/keyrings/couch.asc")


def signed_fields(signed, armor):
    with tempfile.TemporaryDirectory(prefix="couch-signature-") as temporary:
        root = Path(temporary)
        try:
            match = re.fullmatch(rb"-----BEGIN PGP PUBLIC KEY BLOCK-----\r?\n(?:[^\r\n:]+:[^\r\n]*\r?\n)*\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END PGP PUBLIC KEY BLOCK-----\s*", armor)
            if not match:
                raise ValueError()
            encoded = b"".join(line for line in match[1].splitlines() if not line.startswith(b"="))
            (root / "trusted.gpg").write_bytes(base64.b64decode(encoded, validate=True))
        except ValueError as error:
            raise Rejected("The enrolled Couch public key is invalid.") from error
        (root / "InRelease").write_bytes(signed)
        plaintext = run("/usr/bin/gpgv", "--homedir", temporary, "--keyring", str(root / "trusted.gpg"), "--weak-digest", "SHA1", "--output", "-", str(root / "InRelease"))
        return fields(plaintext.decode())


def authenticate(metadata, manifest, index, fresh):
    if any(metadata.get(key) != value for key, value in {"Origin": "Couch", "Architectures": "amd64", "Components": "main"}.items()) or metadata.get("Suite") not in ("stable", "preview") or metadata.get("Codename") != metadata["Suite"]:
        raise Rejected("The signed release targets an unsupported installation.")
    try:
        start = parsedate_to_datetime(metadata["Date"])
        end = parsedate_to_datetime(metadata["Valid-Until"])
        now = datetime.now(timezone.utc)
        if start.tzinfo is None or end.tzinfo is None or (start - now).total_seconds() > 60 or not 0 < (end - start).total_seconds() <= 7 * 86400 or fresh and end <= now:
            raise ValueError()
        records = {}
        for line in metadata["SHA256"].strip().splitlines():
            match = re.fullmatch(r"\s*([a-f0-9]{64})\s+([1-9][0-9]*)\s+(\S+)", line)
            if not match or match[3] in records:
                raise ValueError()
            records[match[3]] = (match[1], int(match[2]))
        for name, data in (("release.json", manifest), ("main/binary-amd64/Packages", index)):
            if records.get(name) != (hashlib.sha256(data).hexdigest(), len(data)):
                raise ValueError()
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        raise Rejected("Signed release dates or content hashes do not match.") from error


def validate(manifest, index):
    try:
        build, ci = manifest["build"], manifest["ci"]
        identity = manifest["releaseId"]
        if manifest["schemaVersion"] != 1 or not re.fullmatch(r"[1-9][0-9]*\.[1-9][0-9]*", identity) or not VERSION.fullmatch(build["version"]) or not build["version"].endswith("+build." + identity) or not re.fullmatch(r"[a-f0-9]{40}", build["revision"]):
            raise ValueError()
        if build["dirty"] is not False or build["packaged"] is not True or build["target"] != "x86_64-unknown-linux-gnu" or ci["ref"] != "main" or ci["repository"] != "avoid-quest/couch" or ci["workflow"] != "Package" or f'{ci["runId"]}.{ci["attempt"]}' != identity:
            raise ValueError()
        compatibility = manifest["compatibility"]
        if any(compatibility.get(key) != value for key, value in {"os": "ubuntu", "osVersion": "24.04", "architecture": "amd64"}.items()) or not isinstance(manifest["qualification"]["checks"], list) or not manifest["qualification"]["checks"] or not isinstance(manifest["releaseNotes"], str) or not manifest["releaseNotes"].strip():
            raise ValueError()
        records = [fields(paragraph) for paragraph in re.split(r"\r?\n\r?\n", index.decode().strip())]
        packages = manifest["packages"]
        if len(packages) != 2 or len(records) != 2:
            raise ValueError()
        for name, architecture in (("couch", "amd64"), ("couch-appliance", "all")):
            matching = [p for p in packages if p["name"] == name]
            matching_records = [p for p in records if p["Package"] == name]
            if len(matching) != 1 or len(matching_records) != 1:
                raise ValueError()
            package, record = matching[0], matching_records[0]
            if package["version"] != build["version"] or package["architecture"] != architecture or not re.fullmatch(r"[A-Za-z0-9_.+~-]+\.deb", package["filename"]) or type(package["size"]) is not int or not 0 < package["size"] <= 2 * 1024 ** 3 or not SHA.fullmatch(package["sha256"]):
                raise ValueError()
            expected = {"Package": name, "Version": package["version"], "Architecture": architecture, "Filename": f'releases/{identity}/{package["filename"]}', "Size": str(package["size"]), "SHA256": package["sha256"]}
            if any(record.get(key) != value for key, value in expected.items()):
                raise ValueError()
        if packages[0]["filename"] == packages[1]["filename"]:
            raise ValueError()
        return manifest
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        raise Rejected("The release manifest and package index disagree.") from error


def copy_receipt(source, destination, key, fresh=True, expected=None):
    """Copy into a new private directory, or verify pinned files when destination is None."""
    try:
        descriptor = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            signed, raw, index = (read_at(descriptor, name) for name in ("InRelease", "release.json", "Packages"))
            identity = hashlib.sha256(raw).hexdigest()
            if expected is not None and identity != expected:
                raise Rejected("The staged candidate identity changed.")
            authenticate(signed_fields(signed, key), raw, index, fresh)
            manifest = validate(load_json(raw), index)
            if destination is not None:
                needed = sum(package["size"] for package in manifest["packages"]) + len(signed) + len(raw) + len(index) + RESERVE
                if shutil.disk_usage(destination).free < needed:
                    raise Rejected("The TV needs more update storage before retaining this release.")
                for name, data in (("InRelease", signed), ("release.json", raw), ("Packages", index)):
                    with (destination / name).open("xb") as output:
                        output.write(data)
                        output.flush()
                        os.fsync(output.fileno())
            for package in manifest["packages"]:
                source_fd = os.open(package["filename"], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptor)
                with os.fdopen(source_fd, "rb") as stream, ((destination / package["filename"]).open("xb") if destination is not None else nullcontext()) as output:
                    info = os.fstat(stream.fileno())
                    if not stat.S_ISREG(info.st_mode) or info.st_size != package["size"]:
                        raise Rejected("A staged Debian archive has the wrong type or size.")
                    digest, size = hashlib.sha256(), 0
                    while block := stream.read(1024 * 1024):
                        size += len(block)
                        if size > package["size"]:
                            raise Rejected("A staged Debian archive changed during verification.")
                        digest.update(block)
                        if output is not None:
                            output.write(block)
                    if size != package["size"] or digest.hexdigest() != package["sha256"]:
                        raise Rejected("A staged Debian archive failed authentication.")
                    if output is not None:
                        output.flush()
                        os.fsync(output.fileno())
                    stream.seek(0)
                    control_path = str(destination / package["filename"]) if destination is not None else f"/dev/fd/{source_fd}"
                    control = fields(run("/usr/bin/dpkg-deb", "--field", control_path, pass_fds=() if output is not None else (source_fd,)).decode())
                    if any(control.get(key) != package[field] for key, field in (("Package", "name"), ("Version", "version"), ("Architecture", "architecture"))):
                        raise Rejected("A Debian archive has an unexpected package identity.")
            return identity, manifest
        finally:
            os.close(descriptor)
    except (OSError, UnicodeError) as error:
        raise Rejected("The signed receipt could not be read or retained safely.") from error
