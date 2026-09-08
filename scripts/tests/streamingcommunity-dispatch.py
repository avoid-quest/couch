"""Exercise the vendored extractor's real dispatch without network or yt-dlp."""
import json
import re
import runpy
import sys
import types
import unittest
from pathlib import Path


def traverse_obj(value, path):
    for key in path:
        value = value[key]
    return value


# Only the downloaded-page and yt-dlp framework boundaries are stubbed.
class InfoExtractor:
    def _match_id(self, url):
        return re.match(self._VALID_URL, url).group("id")

    def _download_webpage(self, url, media_id):
        return json.dumps({"props": {
            "title": {"id": int(media_id), "name": "The Watchers", "type": "movie"},
            "ziggy": {"location": url},
        }})

    def _html_search_regex(self, pattern, webpage, name):
        return webpage

    def to_screen(self, message):
        pass

    def url_result(self, url):
        return {"_type": "url", "url": url}


for name, attribute, value in [
    ("yt_dlp.utils.traversal", "traverse_obj", traverse_obj),
    ("yt_dlp.extractor.common", "InfoExtractor", InfoExtractor),
]:
    module = types.ModuleType(name)
    setattr(module, attribute, value)
    sys.modules[name] = module

Extractor = runpy.run_path(str(Path(__file__).resolve().parents[2] / "vendor/streamingcommunity/streamingcommunity.py"))["StreamingCommunityIE"]


class DispatchTest(unittest.TestCase):
    def test_movie_slug_containing_watch_redirects_to_movie_watch_page(self):
        for slug in ["the-watchers", "watch", "ordinary-film"]:
            with self.subTest(slug=slug):
                extractor = Extractor()
                extractor._get_video = lambda info: self.fail("Title route dispatched directly to video extraction")
                self.assertEqual(extractor._real_extract(f"https://streamingcommunityz.taxi/it/titles/123-{slug}"), {
                    "_type": "url", "url": "https://streamingcommunityz.taxi/it/watch/123",
                })

    def test_watch_route_extracts_video(self):
        for suffix in ["", "?e=456"]:
            with self.subTest(suffix=suffix):
                extractor = Extractor()
                extractor._get_video = lambda info: {"id": info["props"]["title"]["id"]}
                extractor._get_movie = lambda info: self.fail("Watch route dispatched to movie redirect")
                self.assertEqual(extractor._real_extract(f"https://streamingcommunityz.taxi/it/watch/123{suffix}"), {"id": 123})


if __name__ == "__main__":
    unittest.main()
