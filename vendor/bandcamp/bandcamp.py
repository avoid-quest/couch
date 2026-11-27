import json

from yt_dlp.extractor.common import InfoExtractor


class CouchBandcampSearchIE(InfoExtractor):
    _VALID_URL = r'https://bandcamp\.com/api/fuzzysearch/1/app_autocomplete\?q=(?P<id>[^#]+)$'

    def _real_extract(self, url):
        query = self._match_id(url)
        # Use yt-dlp's existing HTTP transport; Core validates the raw JSON and
        # reports challenge HTML without solving it or retrying the request.
        body = self._download_webpage(url, query)
        return self.playlist_result([], query, couch_bandcamp_search=body)


class CouchBandcampFanIE(InfoExtractor):
    _VALID_URL = r'https://bandcamp\.com/(?P<id>[a-z0-9_]{1,64})(?:/wishlist)?$'

    def _real_extract(self, url):
        fan = self._match_id(url)
        # The fan's page as served; Core reads its pagedata literal.
        body = self._download_webpage(url, fan)
        return self.playlist_result([], fan, couch_bandcamp_page=body)


class CouchBandcampFanItemsIE(InfoExtractor):
    _VALID_URL = (r'https://bandcamp\.com/api/fancollection/1/(?P<list>collection|wishlist)_items'
                  r'\?fan_id=(?P<id>\d{1,20})&older_than_token=(?P<token>[0-9a-z:]{1,100})&count=(?P<count>\d{1,3})$')

    def _real_extract(self, url):
        match = self._match_valid_url(url)
        # The fan page's own paging request: one POST of the fields it sends.
        body = self._download_webpage(
            url.split('?')[0], match.group('id'),
            data=json.dumps({
                'fan_id': int(match.group('id')),
                'older_than_token': match.group('token'),
                'count': int(match.group('count')),
            }).encode(),
            headers={'Content-Type': 'application/json'})
        return self.playlist_result([], match.group('id'), couch_bandcamp_page=body)
