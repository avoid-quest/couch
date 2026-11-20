import json
from urllib.parse import urljoin
from yt_dlp.extractor.twitch import TwitchStreamIE, TwitchVodIE


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
                    if not (isinstance(spec, dict) and isinstance(spec.get('images'), list)
                            and spec['images'] and isinstance(spec['images'][0], str)):
                        continue
                    try:
                        if urljoin(storyboard_json_url, spec['images'][0]) == fmt.get('url'):
                            fmt.update(couch_interval=spec.get('interval'), couch_frames=spec.get('count'))
                            break
                    except ValueError:
                        pass  # Optional preview URLs must not reject playable formats.
                yield fmt
        finally:
            self._couch_storyboard_url = None
            self._couch_storyboards = []


class _CouchTwitchStreamIE(TwitchStreamIE, plugin_name='couch'):
    # Upstream's live token names the site player, whose mid-rolls arrive as Twitch's "Commercial
    # break in progress" slate; an embed player token (Streamlink's default) keeps the stream.
    def _download_access_token(self, video_id, token_kind, param_name):
        method = f'{token_kind}PlaybackAccessToken'
        query = '{ %s(%s: %s, params: {platform: "web", playerBackend: "mediaplayer", playerType: "embed"}) { value signature } }'  # noqa: UP031
        return self._download_base_gql(
            video_id, {'query': query % (method, param_name, json.dumps(video_id))},
            f'Downloading {token_kind} access token GraphQL')['data'][method]
