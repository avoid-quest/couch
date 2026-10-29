from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.extractor.twitch import TwitchVodIE
from yt_dlp_plugins.extractor.twitch import _CouchTwitchVodIE


class CouchTwitchTestIE(InfoExtractor):
    _VALID_URL = r'couchtwitch:test'

    def _real_extract(self, url):
        # Scrubbed native JSON shapes from public VODs 635475444 and 2911384262.
        original = TwitchVodIE._download_json
        calls = []
        spec = []

        def download(extractor, url, *args, **kwargs):
            calls.append(url)
            return spec

        TwitchVodIE._download_json = download
        try:
            for duration, interval, width, height in [(11643, 59, 110, 62), (25593, 128, 160, 90)]:
                spec = [
                    {'count': 200, 'width': width, 'height': height, 'rows': 40, 'cols': 5, 'interval': interval, 'images': ['low.jpg']},
                    {'count': 200, 'width': 220, 'height': 124, 'rows': 10, 'cols': 5, 'interval': interval, 'images': ['high-0.jpg', 'high-1.jpg', 'high-2.jpg', 'high-3.jpg']},
                ]
                extractor = _CouchTwitchVodIE(self._downloader)
                formats = list(extractor._extract_storyboard('fixture', 'https://images.example/storyboards/spec.json', duration))
                assert len(formats) == 2
                assert all(f['couch_frames'] == 200 and f['couch_interval'] == interval for f in formats)
                assert all(f['fps'] == 200 / duration for f in formats), 'Keep upstream metadata intact'
                assert formats[1]['fragments'][0]['url'] == 'https://images.example/storyboards/low.jpg'
                assert extractor._couch_storyboards == []
            spec = [
                {'count': 200, 'width': 160, 'height': 90, 'rows': 40, 'cols': 5, 'interval': 128, 'images': ['https://[invalid/image.jpg']},
                {'count': 200, 'width': 110, 'height': 62, 'rows': 40, 'cols': 5, 'interval': 128, 'images': ['valid.jpg']},
            ]
            formats = list(extractor._extract_storyboard('fixture', 'https://images.example/storyboards/spec.json', 25593))
            assert formats, 'Malformed optional preview URLs must not abort extraction'
            assert any(f.get('couch_interval') == 128 for f in formats), 'Valid previews still survive'
            assert extractor._couch_storyboards == []
            assert calls == ['https://images.example/storyboards/spec.json'] * 3, 'Exactly one JSON request per extraction'
        finally:
            TwitchVodIE._download_json = original
        return {'id': 'test', 'title': 'Native Twitch timing retained', 'url': 'https://media.example/video.mp4'}
