from yt_dlp.extractor.common import InfoExtractor


class CouchBandcampSearchIE(InfoExtractor):
    _VALID_URL = r'https://bandcamp\.com/api/fuzzysearch/1/app_autocomplete\?q=(?P<id>[^#]+)$'

    def _real_extract(self, url):
        query = self._match_id(url)
        # Use yt-dlp's existing HTTP transport; Core validates the raw JSON and
        # reports challenge HTML without solving it or retrying the request.
        body = self._download_webpage(url, query)
        return self.playlist_result([], query, couch_bandcamp_search=body)
