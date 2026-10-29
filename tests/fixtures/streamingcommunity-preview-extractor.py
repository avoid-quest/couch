from yt_dlp.extractor.common import InfoExtractor
from yt_dlp_plugins.extractor.streamingcommunity import StreamingCommunityIE


class CouchStreamingPreviewTestIE(InfoExtractor):
    _VALID_URL = r'couchstreamingpreview:test'

    def _real_extract(self, url):
        info = {'props': {'embedUrl': 'https://wrapper.example/embed', 'title': {
            'id': 1, 'name': 'Fixture', 'release_date': '2026-10-01', 'created_at': '2026-10-01', 'updated_at': '2026-10-01', 'type': 'movie',
        }}}
        for literal, expected in [("'https://images.example/thumbs.vtt';", 'https://images.example/thumbs.vtt'),
                                  ("'../thumbs.vtt'\n", 'https://player.example/thumbs.vtt'),
                                  ("'prefix' + expression;", None), ("eval('code');", None), ("'https://[';", None)]:
            calls = []
            extractor = StreamingCommunityIE(self._downloader)
            def page(url, *args, **kwargs):
                calls.append(url)
                if len(calls) == 1:
                    return '<iframe src="https://player.example/embed/1"></iframe>'
                assert len(calls) == 2, 'No extra player or manifest request for previews'
                return "window.masterPlaylist = {params: {}, url: 'https://media.example/master.m3u8'}; window.canPlayFHD = true; window.thumbnailsUrl = " + literal
            extractor._download_webpage = page
            extractor._extract_m3u8_formats_and_subtitles = lambda *args, **kwargs: ([{'url': 'https://media.example/video.m3u8'}], {})
            media = extractor._get_video(info)
            assert media.get('couch_preview_vtt') == expected
            assert len(calls) == 2 and len(media['formats']) == 1
        return {'id': 'test', 'title': 'Vixcloud literal retained', 'url': 'https://media.example/video.mp4'}
