#!/usr/bin/env python3
"""Execute installed helpers through a FUSE-mounted AppImage as its runtime user."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import wave

parser = argparse.ArgumentParser()
parser.add_argument("app")
parser.add_argument("output")
args = parser.parse_args()
app, output = Path(args.app), Path(args.output)
output.mkdir(exist_ok=True)
summary = {"scope": "disposable-key preparation, no GUI/playback or Mac-offline acceptance",
           "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "uid": os.getuid(), "app": str(app),
           "archiveSha256": hashlib.sha256(app.read_bytes()).hexdigest(), "checks": {}}

def record(name, command, env=None, timeout=180):
    start = time.monotonic()
    with (output / (name + ".stdout")).open("wb") as stdout, (output / (name + ".stderr")).open("wb") as stderr:
        try:
            result = subprocess.run(command, stdout=stdout, stderr=stderr, env=env, timeout=timeout)
            status = result.returncode
        except subprocess.TimeoutExpired:
            status = "timeout"
    summary["checks"][name] = {"command": command, "exit": status, "seconds": round(time.monotonic() - start, 3)}
    if status != 0:
        summary.setdefault("firstFailure", name)
    (output / (name + ".exit")).write_text(str(status) + "\n")
    return status

mount = None
pid = None
try:
    # The Xfce preparation inspected this same first mount before invoking helpers.
    if (output / "mount.pid").exists():
        pid = int((output / "mount.pid").read_text())
    else:
        with (output / "mount.stdout").open("wb") as stdout, (output / "mount.stderr").open("wb") as stderr:
            process = subprocess.Popen([str(app), "--appimage-mount"], stdout=stdout, stderr=stderr, start_new_session=True)
            pid = process.pid
        (output / "mount.pid").write_text(str(pid))
    for _ in range(120):
        path = (output / "mount.stdout").read_text().strip()
        if path and Path(path).is_dir():
            mount = Path(path)
            break
        time.sleep(1)
    if mount is None:
        raise RuntimeError("Standard AppImage mount did not become available within 120 seconds")
    summary["mount"] = str(mount)
    summary["mountCommand"] = [str(app), "--appimage-mount"]
    summary["mountMethod"] = "standard FUSE runtime, no extraction"
    for name in ["AppRun", "apprun-hooks/linuxdeploy-plugin-gtk.sh", "apprun-hooks/linuxdeploy-plugin-gstreamer.sh"]:
        (output / Path(name).name).write_bytes((mount / name).read_bytes())
    env = dict(os.environ, APPDIR=str(mount), LD_LIBRARY_PATH=str(mount / "usr/lib"))
    summary["helperEnvironment"] = {key: env[key] for key in ["APPDIR", "LD_LIBRARY_PATH"]}
    build = json.loads((app.parent / "build.json").read_text())
    summary["signedBuild"] = build
    helpers = mount / "usr/lib/Couch/tools"
    summary["helpers"] = {}
    for name in ["deno", "yt-dlp", "ffprobe"]:
        path = helpers / name
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        summary["helpers"][name] = {"path": str(path), "sha256": digest, "matchesSignedBuild": digest == build["helpers"][name]["sha256"]}
        if not summary["helpers"][name]["matchesSignedBuild"]:
            raise RuntimeError(name + " hash differs from signed build")
        record(name + "-linkage", ["ldd", str(path)], env)
    wav = output / "sample.wav"
    with wave.open(str(wav), "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(8000)
        stream.writeframes(b"\x00\x00" * 8000)
    summary["fixture"] = {"path": str(wav), "sha256": hashlib.sha256(wav.read_bytes()).hexdigest(), "description": "1 second mono 8000 Hz PCM s16le silence"}
    record("deno", [str(helpers / "deno"), "eval", "console.log(6*7)"], env)
    record("yt-dlp", [str(helpers / "yt-dlp"), "--version"], env)
    record("ffprobe", [str(helpers / "ffprobe"), "-v", "error", "-show_format", "-show_streams", "-of", "json", str(wav)], env)
except Exception as error:
    summary["error"] = str(error)
    summary.setdefault("firstFailure", "probe")
finally:
    if pid:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    summary["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
