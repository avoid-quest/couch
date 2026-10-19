from yt_dlp.extractor.common import InfoExtractor
from yt_dlp_plugins.extractor.soundcloud import _CouchSoundcloudIE, _CouchSoundcloudSearchIE


class CouchSoundcloudTestIE(InfoExtractor):
    _VALID_URL = r'couchsoundcloud:test'

    def _real_extract(self, url):
        def no_network(*args, **kwargs):
            raise AssertionError('Metadata must not probe thumbnail URLs or resolve streams')

        track = {
            'id': 123, 'title': 'Track', 'duration': 42000,
            'permalink_url': 'https://soundcloud.com/artist/track',
            'artwork_url': 'https://i1.sndcdn.com/artworks-example-large.png',
            'user': {'username': 'Artist', 'avatar_url': 'https://i1.sndcdn.com/avatars-example-large.jpg'},
            'media': {'transcodings': [{'url': 'https://api-v2.soundcloud.com/media/123', 'preset': 'mp3_0_1',
                                       'format': {'protocol': 'progressive', 'mime_type': 'audio/mpeg'}}]},
        }
        for extractor in [_CouchSoundcloudIE(self._downloader), _CouchSoundcloudSearchIE(self._downloader)]:
            extractor._CLIENT_ID = 'test'
            extractor._request_webpage = no_network
            extractor._call_api = no_network
            for artwork in [track['artwork_url'], None]:
                metadata = extractor._extract_info_dict({**track, 'artwork_url': artwork}, extract_flat=True)
                assert metadata['title'] == 'Track' and metadata['duration'] == 42
                assert metadata['formats'] is None
                assert metadata['thumbnails'][-1]['url'].endswith('-t500x500.jpg')
                assert all(t['id'] != 'original' for t in metadata['thumbnails'])

        calls = []
        def stream(url, *args, **kwargs):
            calls.append(url)
            return {'url': 'https://audio.example/track.mp3'}

        extractor = _CouchSoundcloudIE(self._downloader)
        extractor._CLIENT_ID = 'test'
        extractor._request_webpage = no_network
        extractor._call_api = stream
        metadata = extractor._extract_info_dict(track)
        assert calls == ['https://api-v2.soundcloud.com/media/123']
        assert metadata['formats'][0]['url'] == 'https://audio.example/track.mp3'
        return {'id': 'test', 'title': 'SoundCloud offline checks passed', 'url': 'https://audio.example/track.mp3'}
