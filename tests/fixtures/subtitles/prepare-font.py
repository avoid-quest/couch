"""Rebuild the renamed test subset from the pinned upstream release archive."""

import hashlib
import io
from pathlib import Path
import sys
import unicodedata
import zipfile

from fontTools import subset
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent
archive = Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(archive).hexdigest() == "5c6e497a2f36552cb5ffb112c413a6af39c0f3c47653662b90b4fa6499822fd7", "Use the pinned DejaVu Sans 2.37 release ZIP"
with zipfile.ZipFile(io.BytesIO(archive)) as source:
    original = source.read("dejavu-sans-ttf-2.37/ttf/DejaVuSans.ttf")
    license_text = source.read("dejavu-sans-ttf-2.37/LICENSE")
font = TTFont(io.BytesIO(original), recalcTimestamp=False)
options = subset.Options()
options.layout_features = ["*"]
options.name_IDs = ["*"]
options.name_legacy = True
options.name_languages = ["*"]
options.notdef_outline = True
options.ignore_missing_unicodes = False
subsetter = subset.Subsetter(options=options)
text = "".join(p.read_text() for p in root.glob("*.ass")) + (root / "plain.srt").read_text() + "IMAGE 12"
unicodes = {ord(c) for c in text if c.isprintable() and c != "\ue000"}
# Libass's simple shaper uses Arabic presentation-form cmap entries. GSUB
# closure alone retains their outlines, but drops those Unicode mappings.
forms = {u for u in font.getBestCmap() if 0xFB50 <= u <= 0xFEFF and {ord(c) for c in unicodedata.normalize("NFKC", chr(u))} <= unicodes}
invisible = {0x200B, 0x200C, 0x200D, 0xFEFF} & font.getBestCmap().keys()
subsetter.populate(unicodes=unicodes | forms | invisible)
subsetter.subset(font)

# A private-use three-bar glyph makes accidental system-font fallback observable.
pen = TTGlyphPen(None)
for x, height in [(100, 400), (450, 900), (800, 1400)]:
    pen.moveTo((x, 0))
    pen.lineTo((x + 200, 0))
    pen.lineTo((x + 200, height))
    pen.lineTo((x, height))
    pen.closePath()
font.setGlyphOrder([*font.getGlyphOrder(), "corpusMarker"])
font["glyf"]["corpusMarker"] = pen.glyph()
font["hmtx"].metrics["corpusMarker"] = (1150, 100)
for table in font["cmap"].tables:
    if table.isUnicode():
        table.cmap[0xE000] = "corpusMarker"
names = {1: "Couch Corpus Sans", 2: "Regular", 3: "CouchCorpusSans-1", 4: "Couch Corpus Sans", 6: "CouchCorpusSans", 16: "Couch Corpus Sans", 17: "Regular"}
for record in font["name"].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
font.save(root / "CouchCorpusSans.ttf")
(root / "FONT-LICENSE.txt").write_bytes(license_text)
for name, data in [("release archive", archive), ("original TTF", original), ("license", license_text), ("subset TTF", (root / "CouchCorpusSans.ttf").read_bytes())]:
    print(name, len(data), hashlib.sha256(data).hexdigest())
