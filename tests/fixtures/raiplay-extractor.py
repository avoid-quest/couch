from xml.etree.ElementTree import fromstring
from yt_dlp.extractor.common import InfoExtractor
from yt_dlp_plugins.extractor.raiplay import _CouchRaiPlayIE


class CouchRaiPlayTestIE(InfoExtractor):
    _VALID_URL = r'couchraiplay:test'

    def _real_extract(self, url):
        extractor = _CouchRaiPlayIE(self._downloader)
        calls = []
        descriptor = 'https://preview.example/relinker?id=timed-cues'
        live = False

        def webpage(url, video_id, *args, **kwargs):
            calls.append((url, kwargs))
            assert kwargs['query']['output'] == 64
            assert kwargs['headers']['User-Agent'] == 'Rai'
            # Exercise upstream XML parsing and our override, not a mocked result.
            return f'''<root><url type="content">https://video.example/list.m3u8</url>
                <is_live>{'Y' if live else 'N'}</is_live><duration>00:04:40</duration>
                <vtt_poster_thumbs_url><![CDATA[{descriptor}]]></vtt_poster_thumbs_url></root>''', None

        extractor._download_webpage_handle = webpage
        extractor._fix_m3u8_formats = lambda *_: [{'url': 'https://video.example/list.m3u8'}]
        extractor._create_http_urls = lambda *_: []
        expected = {'is_live': False, 'duration': 280.0, 'formats': [{'url': 'https://video.example/list.m3u8'}]}
        for descriptor in [descriptor, '', '  ', 'https://preview.example/new-track']:
            result = extractor._extract_relinker_info('https://relinker.example/item', 'item')
            assert {k: v for k, v in result.items() if k != 'couch_preview_vtt'} == expected
            assert result.get('couch_preview_vtt', '') == descriptor.strip()
        assert len(calls) == 4, 'Preview retention must not fetch the relinker again'
        live = True
        assert 'couch_preview_vtt' not in extractor._extract_relinker_info('https://relinker.example/live', 'live')
        assert 'couch_preview_vtt' not in extractor._extract_relinker_info('relative-source', 'next')
        assert len(calls) == 5
        return {'id': 'test', 'title': 'RaiPlay preview retention checks passed', 'url': 'https://video.example/video.mp4'}
