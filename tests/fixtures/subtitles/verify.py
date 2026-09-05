"""Validate corpus bytes and FFmpeg reference frames, never product playback."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import zipfile

import av
from fontTools.ttLib import TTFont
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--font-archive", type=Path, required=True)
    args = parser.parse_args()
    corpus = args.corpus.resolve()
    ffmpeg = str(Path(shutil.which(args.ffmpeg) or args.ffmpeg).resolve())
    evidence = corpus / "verification"
    evidence.mkdir(exist_ok=True)
    (evidence / "result.json").unlink(missing_ok=True)
    checks = []

    def check(condition, description):
        if not condition:
            raise AssertionError(description)
        checks.append(description)

    manifest = json.loads((corpus / "manifest.json").read_text())
    for name, record in manifest["files"].items():
        check(hashlib.sha256((corpus / name).read_bytes()).hexdigest() == record["sha256"], f"Input hash: {name}")
    for name, sha in manifest["sources"].items():
        check(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == sha, f"Generation source hash: {name}")
    font = TTFont(ROOT / "CouchCorpusSans.ttf")
    check(all(table in font for table in ["GSUB", "GPOS", "GDEF"]), "Subset retains shaping tables")
    check(font.getBestCmap().get(0xE000) is not None, "Subset includes the authored private-use marker")
    names = {record.toUnicode() for record in font["name"].names if record.nameID in (1, 4, 16)}
    check(names == {"Couch Corpus Sans"}, "Subset internal family and full names are unique")

    streams = {}
    for name, expected in {
        "text": [("ssa", "eng", 1), ("ssa", "ita", 64), ("srt", "rus", 0)],
        "bitmap": [("pgssub", "eng", 64), ("dvdsub", "ita", 1)],
    }.items():
        with av.open(str(corpus / f"{name}.mkv")) as container:
            actual = [(s.codec_context.name, s.metadata["language"], s.disposition.value) for s in container.streams.subtitles]
            check(actual == expected, f"{name}: decoded codecs, languages, default and forced flags")
            check(container.streams.video[0].width == 640 and container.streams.video[0].height == 360, f"{name}: 640x360 video")
            if name == "text":
                attachments = {s.metadata["filename"]: s.data for s in container.streams.attachments}
                for attachment in ["CouchCorpusSans.ttf", "FONT-LICENSE.txt"]:
                    check(attachments[attachment] == (ROOT / attachment).read_bytes(), f"Embedded {attachment} matches source")
            else:
                private = container.streams.subtitles[1].codec_context.extradata.decode()
                check("size: 640x360" in private and "palette:" in private, "VobSub CodecPrivate has canvas and palette")
            packets = {}
            for packet in container.demux(*container.streams.subtitles):
                if not packet.size:
                    continue
                subtitles = packet.decode()
                pts = round(float(packet.pts * packet.time_base), 3)
                duration = round(float(packet.duration * packet.time_base), 3)
                if name == "bitmap" and packet.stream.index == 2:
                    data = bytes(packet)
                    control = int.from_bytes(data[2:4], "big")
                    stop = int.from_bytes(data[control + 2:control + 4], "big")
                    cursor, commands = control + 4, []
                    while data[cursor] != 255:
                        command = data[cursor]
                        commands.append(command)
                        cursor += 1 + {0: 0, 1: 0, 2: 0, 3: 2, 4: 2, 5: 6, 6: 4}[command]
                    check([command for command in commands if command in (0, 1)] == [0 if pts == 8 else 1], f"VobSub at {pts}s: forced/ordinary display command survives conversion")
                    stop_ms = int.from_bytes(data[stop:stop + 2], "big") * 1024 / 90
                    check(abs(stop_ms - 4000) < 12 and data[stop + 4] == 2, f"VobSub at {pts}s: stop command within one DVD clock tick")
                packets.setdefault(packet.stream.index, []).append([pts, duration, len(subtitles)])
            streams[name] = packets
    check(streams["text"] == {1: [[2, 4, 1], [8, 4, 1]], 2: [[3, 2, 1]], 3: [[2, 4, 1], [8, 4, 1]]}, "Text cues retain exact timestamps and decode")
    check(streams["bitmap"] == {1: [[2, 0, 1], [6, 0, 0], [8, 0, 1], [12, 0, 0]], 2: [[2, 4, 1], [8, 4, 1]]}, "PGS cues include explicit clears; DVD cues retain resolved durations")
    with av.open(str(corpus / "replacement.mkv")) as container:
        check(not container.streams.subtitles and not container.streams.attachments, "Replacement has no subtitles or font attachments")
        check(sum(1 for _ in container.decode(video=0)) == 336, "Replacement decodes all 14 seconds at 24 fps")

    # WDS is ignored by FFmpeg's decoder; check its bounded one-window subset.
    data = (corpus / "images.sup").read_bytes()
    offset, presentations, windows = 0, [], []
    while offset < len(data):
        check(data[offset:offset + 2] == b"PG", f"SUP segment header at {offset}")
        pts, dts, kind, size = struct.unpack_from(">IIBH", data, offset + 2)
        body = data[offset + 13:offset + 13 + size]
        check(len(body) == size and dts <= pts, f"SUP segment bounds at {offset}")
        if kind == 0x16:
            presentations.append([pts // 90000, body[10], body[14] if body[10] else None])
        if kind == 0x17:
            windows.append(struct.unpack(">BBHHHH", body))
        offset += 13 + size
    check(presentations == [[2, 1, 0], [6, 0, None], [8, 1, 64], [12, 0, None]], "PGS second object alone has its independent forced-event bit")
    check(windows == [(1, 0, 200, 290, 240, 44)] * 2, "PGS windows contain their complete objects inside the canvas")

    def frame(name, seconds, label, filter_args=()):
        result = subprocess.run([ffmpeg, "-hide_banner", "-nostdin", "-y", "-threads", "1", "-i", f"{name}.mkv", *filter_args,
            "-ss", str(seconds), "-frames:v", "1", "-update", "1", f"verification/{label}.png"], cwd=corpus, capture_output=True, text=True)
        (evidence / f"{label}.log").write_text(result.stderr)
        result.check_returncode()
        return Image.open(evidence / f"{label}.png").convert("RGB")

    blank = frame("background", 3, "blank")
    references = {}
    for number in (1, 2):
        image = blank.copy()
        card = Image.open(corpus / f"image-{number}.png").convert("RGBA")
        image.paste(card, (200, 290), card)
        references[number] = image
        image.save(evidence / f"expected-image-{number}.png")
    for track, title in [(0, "pgs"), (1, "vobsub")]:
        for seconds in (1, 3, 7, 9, 13):
            actual = frame("bitmap", seconds, f"{title}-{seconds}", ["-filter_complex", f"[0:v][0:s:{track}]overlay"])
            expected = references[1 if seconds == 3 else 2] if seconds in (3, 9) else blank
            # Decoding to yuv420p can move white by one level. The exact bright
            # glyph mask checks placement, scanline parity, shape and clearing.
            mask = lambda image: image.convert("L").point(lambda value: 255 if value > 180 else 0)
            check(ImageChops.difference(mask(actual), mask(expected)).getbbox() is None, f"{title} at {seconds}s: exact bright glyph mask or blank interval")

    for track, title in [(0, "ass"), (1, "forced"), (2, "srt")]:
        for seconds in (1, 4, 7, 9, 13):
            actual = frame("text", seconds, f"{title}-{seconds}", ["-vf", f"subtitles=text.mkv:si={track}"])
            box = ImageChops.difference(blank, actual).getbbox()
            visible = seconds == 4 or seconds == 9 and track != 1
            check(bool(box) == visible and (not box or box[1] > 230), f"{title} at {seconds}s: bounded glyphs or blank interval")
    log = (evidence / "ass-9.log").read_text()
    check("-> CouchCorpusSans, 0, CouchCorpusSans" in log and "failed to find any fallback" not in log, "Libass reference selects the attached font without missing-glyph fallback")

    # Compare shapes to the complete original font, not a second render of the
    # same subset. This caught missing Arabic presentation-form cmap entries.
    archive = args.font_archive.read_bytes()
    check(hashlib.sha256(archive).hexdigest() == "5c6e497a2f36552cb5ffb112c413a6af39c0f3c47653662b90b4fa6499822fd7", "Original font archive matches pinned provenance")
    with zipfile.ZipFile(args.font_archive) as source:
        (evidence / "DejaVuSans.ttf").write_bytes(source.read("dejavu-sans-ttf-2.37/ttf/DejaVuSans.ttf"))
        (evidence / "FONT-LICENSE.txt").write_bytes(source.read("dejavu-sans-ttf-2.37/LICENSE"))
    shutil.copy(ROOT / "CouchCorpusSans.ttf", evidence)
    script = (ROOT / "styled.ass").read_text()
    # Isolate the mixed-script event so the original font need not supply the
    # private marker that only the derived font intentionally contains.
    script = "\n".join(line for line in script.splitlines() if "\ue000" not in line) + "\n"
    (evidence / "subset.ass").write_text(script)
    (evidence / "original.ass").write_text(script.replace("Couch Corpus Sans", "DejaVu Sans"))
    for shaper in ("simple", "complex"):
        frames = [frame("background", 9, f"{font}-{shaper}", ["-vf", f"ass=verification/{font}.ass:fontsdir=verification:shaping={shaper}"]) for font in ("subset", "original")]
        check(ImageChops.difference(*frames).getbbox() is None, f"{shaper} shaping: mixed-script subset pixels equal complete upstream font")
    output = {"scope": "Local format and FFmpeg reference validation only; no Couch/native/package/HTTP/hardware qualification.", "pyav": av.__version__, "libraries": av.library_versions, "ffmpeg": manifest["ffmpeg"], "streams": streams, "checks": checks}
    (evidence / "result.json").write_text(json.dumps(output, indent=2) + "\n")
    print(f"Passed {len(checks)} local corpus checks; evidence: {evidence}")


if __name__ == "__main__":
    main()
