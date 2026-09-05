"""Require the corpus verifier to reject three independently corrupted inputs."""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

import av
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent


def fallback_probes(sources, case, ffmpeg, archive):
    spec = importlib.util.spec_from_file_location("corpus_verifier", sources / "verify.py")
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    if not hasattr(verifier, "uses_only_font"):
        return []  # The historical verifier has no reference-log assertion.
    probes = case / "font-probes"
    probes.mkdir()
    font = TTFont(sources / "CouchCorpusSans.ttf", recalcTimestamp=False)
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap.pop(0x03BB, None)
    font.save(probes / "CouchCorpusSans.ttf")
    with zipfile.ZipFile(archive) as source:
        (probes / "DejaVuSans.ttf").write_bytes(source.read("dejavu-sans-ttf-2.37/ttf/DejaVuSans.ttf"))
        (probes / "FONT-LICENSE.txt").write_bytes(source.read("dejavu-sans-ttf-2.37/LICENSE"))
    script = (sources / "styled.ass").read_text()
    (probes / "mixed.ass").write_text("\n".join(line for line in script.splitlines() if "\ue000" not in line) + "\n")
    records = []
    for shaper in ("simple", "complex"):
        result = subprocess.run([ffmpeg, "-hide_banner", "-nostdin", "-y", "-i", "../corpus/background.mkv", "-vf", f"ass=mixed.ass:fontsdir=.:shaping={shaper}", "-ss", "9", "-frames:v", "1", "-update", "1", f"{shaper}.png"], cwd=probes, capture_output=True, text=True, check=True)
        (probes / f"{shaper}.log").write_text(result.stderr)
        log = result.stderr
        requests = [line for line in log.splitlines() if "selecting one more font" in line]
        foreign = [line for line in log.splitlines() if "fontselect: (Couch Corpus Sans" in line and "-> CouchCorpusSans, 0, CouchCorpusSans" not in line]
        without_requests = "\n".join(line for line in log.splitlines() if line not in requests)
        without_foreign = "\n".join(line for line in log.splitlines() if line not in foreign)
        records.append({"shaper": shaper, "fallback_requests": requests, "resolved_fallback": foreign,
            "full_log_rejected": not verifier.uses_only_font(log), "unexpected_selection_rejected": not verifier.uses_only_font(without_requests),
            "request_alone_rejected": not verifier.uses_only_font(without_foreign)})
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="New, dedicated directory for copied sources, inputs and evidence")
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--font-archive", type=Path, required=True)
    parser.add_argument("--verifier", type=Path, default=ROOT / "verify.py", help="Use an immutable old verifier to reproduce a false pass")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    ffmpeg = str(Path(args.ffmpeg).resolve())
    records = []
    for name, rejection in [("opaque-palette", "complete composite"), ("delayed-start", "start command"), ("missing-glyph", "fallback or unexpected font")]:
        case = args.output / name
        sources, corpus = case / "sources", case / "corpus"
        shutil.copytree(ROOT, sources)
        shutil.copyfile(args.verifier, sources / "verify.py")
        if name == "missing-glyph":
            # The styled cue needs 'u', which the mixed-script reference cue
            # does not contain. A later reference comparison cannot catch it.
            font = TTFont(sources / "CouchCorpusSans.ttf", recalcTimestamp=False)
            for table in font["cmap"].tables:
                if table.isUnicode():
                    table.cmap.pop(0x0075, None)
            font.save(sources / "CouchCorpusSans.ttf")
        subprocess.run([sys.executable, str(sources / "generate.py"), str(corpus), "--ffmpeg", ffmpeg], check=True, stdout=subprocess.DEVNULL)
        bitmap = corpus / "bitmap.mkv"
        data = bitmap.read_bytes()
        if name == "opaque-palette":
            palette = bytes([0x14, 0, 12, 0, 0, 0, 16, 128, 128, 0, 1, 235, 128, 128, 255])
            assert data.count(palette) == 2, "Both PGS palette definitions must be present"
            data = data.replace(palette, palette[:9] + b"\xff" + palette[10:])
        if name == "delayed-start":
            with av.open(str(bitmap)) as container:
                packet = next(p for p in container.demux(container.streams.subtitles[1]) if p.size)
                spu = bytes(packet)
            control = int.from_bytes(spu[2:4], "big")
            assert spu[control:control + 2] == b"\0\0" and data.count(spu) == 1
            changed = spu[:control] + (44).to_bytes(2, "big") + spu[control + 2:]
            data = data.replace(spu, changed, 1)
        bitmap.write_bytes(data)
        # Reach semantic checks with an internally consistent manifest. A hash
        # mismatch would not reproduce any of the reviewed false-pass paths.
        manifest_path = corpus / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["files"]["bitmap.mkv"]["sha256"] = hashlib.sha256(data).hexdigest()
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        command = [sys.executable, str(sources / "verify.py"), str(corpus), "--ffmpeg", ffmpeg, "--font-archive", str(args.font_archive.resolve())]
        result = subprocess.run(command, capture_output=True, text=True)
        (case / "verifier.log").write_text(result.stdout + result.stderr)
        logs = [line for path in (corpus / "verification").glob("*.log") for line in path.read_text().splitlines() if "fontselect:" in line or "Glyph" in line]
        record = {"case": name, "command": command, "exit_code": result.returncode, "expected_rejection": rejection,
            "rejected_for_expected_reason": result.returncode != 0 and rejection in result.stderr,
            "diagnostic": result.stderr.splitlines()[-1] if result.stderr else result.stdout.strip(), "font_logs": sorted(set(logs)),
            "files": manifest["files"], "sources": manifest["sources"]}
        records.append(record)
        if name == "missing-glyph":
            requested = any("Glyph 0x75 not found, selecting one more font" in line for line in logs)
            resolved = any("fontselect: (Couch Corpus Sans" in line and "-> CouchCorpusSans, 0, CouchCorpusSans" not in line for line in logs)
            record["successful_fallback_observed"] = requested and resolved
            record["font_log_probes"] = fallback_probes(sources, case, ffmpeg, args.font_archive)
            record["rejected_for_expected_reason"] &= requested and resolved and len(record["font_log_probes"]) == 2 and all(
                probe["fallback_requests"] and probe["resolved_fallback"] and probe["full_log_rejected"] and probe["unexpected_selection_rejected"] and probe["request_alone_rejected"] for probe in record["font_log_probes"])
        print(f"{name}: {record['diagnostic']}")
    (args.output / "result.json").write_text(json.dumps(records, indent=2) + "\n")
    if not all(record["rejected_for_expected_reason"] for record in records):
        raise SystemExit("Negative controls failed: a corrupt input passed or failed for an unrelated reason")
    print("All three corrupt inputs rejected for their semantic defect")


if __name__ == "__main__":
    main()
