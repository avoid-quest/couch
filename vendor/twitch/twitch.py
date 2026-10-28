from urllib.parse import urljoin
from yt_dlp.extractor.twitch import TwitchVodIE


class _CouchTwitchVodIE(TwitchVodIE, plugin_name='couch'):
    # Upstream downloads this JSON already, but substitutes count / video duration
    # for its native interval. Keep that download and all stream extraction intact.
    def _download_json(self, url_or_request, *args, **kwargs):
        result = super()._download_json(url_or_request, *args, **kwargs)
        if url_or_request == getattr(self, '_couch_storyboard_url', None):
            self._couch_storyboards = result if isinstance(result, list) else []
        return result

    def _extract_storyboard(self, item_id, storyboard_json_url, duration):
        self._couch_storyboard_url = storyboard_json_url
        self._couch_storyboards = []
        try:
            for fmt in super()._extract_storyboard(item_id, storyboard_json_url, duration):
                for spec in self._couch_storyboards:
                    if (isinstance(spec, dict) and isinstance(spec.get('images'), list)
                            and spec['images'] and isinstance(spec['images'][0], str)
                            and urljoin(storyboard_json_url, spec['images'][0]) == fmt.get('url')):
                        fmt.update(couch_interval=spec.get('interval'), couch_frames=spec.get('count'))
                        break
                yield fmt
        finally:
            self._couch_storyboard_url = None
            self._couch_storyboards = []
