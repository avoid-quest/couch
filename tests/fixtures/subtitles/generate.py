"""Generate a small offline subtitle corpus; never launches Couch or a container."""

import argparse
import hashlib
import itertools
import json
from pathlib import Path
import struct
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent


def card(number):
    image = Image.new("P", (240, 44))
    image.putpalette([0, 0, 0, 255, 255, 255] + [0] * 762)
    ImageDraw.Draw(image).text((10, 3), f"IMAGE {number}", font=ImageFont.truetype(str(ROOT / "CouchCorpusSans.ttf"), 32), fill=1)
    return image


def segment(seconds, kind, body):
    return b"PG" + struct.pack(">IIBH", seconds * 90000, 0, kind, len(body)) + body


def pgs():
    # One full object per epoch, two colors, no crop or split object segments.
    # FFmpeg's pgssubdec.c defines this subset and its empty-composition clear.
    result = bytearray()
    for composition, seconds in enumerate([2, 6, 8, 12]):
        visible = seconds in (2, 8)
        pcs = struct.pack(">HHBHBBBB", 640, 360, 0x20, composition, 0x80 if visible else 0, 0, 0, int(visible))
        if visible:
            pcs += struct.pack(">HBBHH", 0, 0, 0x40 if seconds == 8 else 0, 200, 290)
        result += segment(seconds, 0x16, pcs)
        if visible:
            image = card(1 if seconds == 2 else 2)
            result += segment(seconds, 0x17, struct.pack(">BBHHHH", 1, 0, 200, 290, 240, 44))
            result += segment(seconds, 0x14, bytes([0, 0, 0, 16, 128, 128, 0, 1, 235, 128, 128, 255]))
            rle = bytearray()
            pixels = image.tobytes()
            for y in range(image.height):
                for color, group in itertools.groupby(pixels[y * image.width:(y + 1) * image.width]):
                    count = len(list(group))
                    rle.extend(bytes([color]) * count if color else bytes([0, 0x40 | (count >> 8), count & 255]))
                rle.extend(b"\0\0")
            ods = b"\0\0\0\xc0" + (len(rle) + 4).to_bytes(3, "big") + struct.pack(">HH", 240, 44) + rle
            result += segment(seconds, 0x15, ods)
        result += segment(seconds, 0x80, b"")
    return bytes(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    (output / "manifest.json").unlink(missing_ok=True)
    commands = []

    def run(*command):
        command = [str(arg) for arg in command]
        command = [args.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-copyts", *command]
        commands.append(command)
        subprocess.run(command, check=True)

    (output / "images.sup").write_bytes(pgs())
    for number in (1, 2):
        card(number).save(output / f"image-{number}.png", transparency=0)
    for name, color in [("background", "0x303030"), ("replacement", "0x183858")]:
        run("-f", "lavfi", "-i", f"color=c={color}:size=640x360:rate=24:duration=14", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-g", "24", "-pix_fmt", "yuv420p", "-fflags", "+bitexact", output / f"{name}.mkv")
    run("-i", output / "background.mkv", "-i", ROOT / "styled.ass", "-i", ROOT / "forced.ass", "-i", ROOT / "plain.srt",
        "-map", "0:v", "-map", "1:s", "-map", "2:s", "-map", "3:s", "-c", "copy",
        "-metadata:s:s:0", "language=eng", "-metadata:s:s:0", "title=ASS styled and mixed scripts", "-disposition:s:0", "default",
        "-metadata:s:s:1", "language=ita", "-metadata:s:s:1", "title=ASS Italian forced", "-disposition:s:1", "forced",
        "-metadata:s:s:2", "language=rus", "-metadata:s:s:2", "title=SRT Russian", "-disposition:s:2", "0",
        "-attach", ROOT / "CouchCorpusSans.ttf", "-metadata:s:t:0", "mimetype=font/ttf",
        "-attach", ROOT / "FONT-LICENSE.txt", "-metadata:s:t:1", "mimetype=text/plain",
        "-fflags", "+bitexact", output / "text.mkv")
    # PGS clear compositions give FFmpeg the ends needed by the DVD encoder.
    run("-fix_sub_duration", "-i", output / "images.sup", "-map", "0:s", "-c:s", "dvdsub", "-s:s", "640x360", "-fflags", "+bitexact", output / "dvd.mkv")
    run("-i", output / "background.mkv", "-i", output / "images.sup", "-i", output / "dvd.mkv",
        "-map", "0:v", "-map", "1:s", "-map", "2:s", "-c", "copy",
        "-metadata:s:s:0", "language=eng", "-metadata:s:s:0", "title=PGS images", "-disposition:s:0", "forced",
        "-metadata:s:s:1", "language=ita", "-metadata:s:s:1", "title=VobSub images", "-disposition:s:1", "default",
        "-fflags", "+bitexact", output / "bitmap.mkv")
    files = {p.name: {"bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(output.iterdir()) if p.suffix in (".mkv", ".sup", ".png")}
    sources = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(ROOT.iterdir()) if p.suffix in (".py", ".ass", ".srt", ".ttf", ".txt")}
    (output / "manifest.json").write_text(json.dumps({"scope": "Generated input files only. Packaged Couch playback is unqualified.", "ffmpeg": subprocess.check_output([args.ffmpeg, "-version"], text=True), "commands": commands, "sources": sources, "files": files}, indent=2) + "\n")
    print(f"Generated corpus and manifest in {output}")


if __name__ == "__main__":
    main()
