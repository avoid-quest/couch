from yt_dlp_plugins.extractor.bandcamp import CouchBandcampSearchIE


class CouchBandcampSearchTestIE(CouchBandcampSearchIE):
    _VALID_URL = r'couchbandcamp:(?P<id>json|html)'

    def _download_webpage(self, url, video_id, *args, **kwargs):
        self.requests += 1
        assert url == f'couchbandcamp:{video_id}'
        return '{"results":[]}' if video_id == 'json' else '<title>Client Challenge</title>'

    def _real_extract(self, url):
        self.requests = 0
        result = super()._real_extract(url)
        assert self.requests == 1
        return result
