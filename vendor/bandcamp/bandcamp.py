import json

from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.utils import ExtractorError

# Core reads at most 8 MiB of helper output, and a page grows when it is escaped as JSON; a fan page is about
# half a MiB.
MAX_BODY = 4 * 1024 * 1024


class CouchBandcampSearchIE(InfoExtractor):
    _VALID_URL = r'https://bandcamp\.com/api/fuzzysearch/1/app_autocomplete\?q=(?P<id>[^#]+)$'

    def _real_extract(self, url):
        query = self._match_id(url)
        # Use yt-dlp's existing HTTP transport; Core validates the raw JSON and
        # reports challenge HTML without solving it or retrying the request.
        body = self._download_webpage(url, query)
        return self.playlist_result([], query, couch_bandcamp_search=body)


class _BoundedPage:
    def _bounded_body(self, url, video_id, **kwargs):
        """The response read up to MAX_BODY, from the address asked for (a redirect is refused)."""
        response = self._request_webpage(url, video_id, **kwargs)
        try:
            if response.url != url:
                raise ExtractorError('Bandcamp redirected this request.', expected=True)
            body = response.read(MAX_BODY + 1)
        finally:
            response.close()
        if len(body) > MAX_BODY:
            raise ExtractorError('Bandcamp returned too much data.', expected=True)
        return body.decode('utf-8', 'replace')


class CouchBandcampFanIE(_BoundedPage, InfoExtractor):
    _VALID_URL = r'https://bandcamp\.com/(?P<id>[a-z0-9_]{1,64})(?:/wishlist)?$'

    def _real_extract(self, url):
        fan = self._match_id(url)
        # The fan's page as served; Core reads its pagedata literal.
        body = self._bounded_body(url, fan)
        return self.playlist_result([], fan, couch_bandcamp_page=body)


class CouchBandcampFanItemsIE(_BoundedPage, InfoExtractor):
    _VALID_URL = (r'https://bandcamp\.com/api/fancollection/1/(?P<list>collection|wishlist)_items'
                  r'\?fan_id=(?P<id>\d{1,20})&older_than_token=(?P<token>[0-9a-z:]{1,100})&count=(?P<count>\d{1,3})$')

    def _real_extract(self, url):
        match = self._match_valid_url(url)
        # The fan page's own paging request: one POST of the fields it sends.
        body = self._bounded_body(
            url.split('?')[0], match.group('id'),
            data=json.dumps({
                'fan_id': int(match.group('id')),
                'older_than_token': match.group('token'),
                'count': int(match.group('count')),
            }).encode(),
            headers={'Content-Type': 'application/json'})
        return self.playlist_result([], match.group('id'), couch_bandcamp_page=body)
