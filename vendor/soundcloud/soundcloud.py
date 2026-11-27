from yt_dlp.extractor.soundcloud import SoundcloudIE, SoundcloudSearchIE, SoundcloudSetIE
from yt_dlp.utils import float_or_none, str_or_none
from yt_dlp.utils.traversal import traverse_obj


# Original artwork needs a serial HEAD request per track. Couch displays the
# known JPEG sizes instead; stream extraction stays with yt-dlp.
class _CouchSoundcloudIE(SoundcloudIE, plugin_name='couch'):
    _ARTWORK_MAP = {key: size for key, size in SoundcloudIE._ARTWORK_MAP.items() if key != 'original'}


class _CouchSoundcloudSearchIE(SoundcloudSearchIE, plugin_name='couch'):
    _ARTWORK_MAP = _CouchSoundcloudIE._ARTWORK_MAP


# A set's page lists only its first tracks in full; the rest are bare IDs, which
# upstream lists as API links without titles. Complete them with the same
# `tracks?ids=` request upstream makes for private sets (at most 50 IDs each), so
# a flat listing names every track and links its public page.
class _CouchSoundcloudSetIE(SoundcloudSetIE, plugin_name='couch'):
    def _extract_set(self, playlist, token=None):
        tracks = playlist.get('tracks') or []
        missing = [str(t['id']) for t in tracks if not t.get('permalink_url') and t.get('id')]
        full = {str(t.get('id')): t for t in tracks if t.get('permalink_url')}
        for start in range(0, len(missing), 50):
            query = {'ids': ','.join(missing[start:start + 50]), 'playlistId': str(playlist['id'])}
            if token:
                query['playlistSecretToken'] = token
            for track in self._call_api(
                    self._API_V2_BASE + 'tracks', str(playlist['id']),
                    'Downloading tracks', query=query, headers=self._HEADERS) or []:
                full[str(track.get('id'))] = track
        playlist = {**playlist, 'tracks': [full.get(str(t.get('id')), t) for t in tracks]}
        result = super()._extract_set(playlist, token)
        for entry in result.get('entries') or []:
            entry.update(traverse_obj(full.get(entry.get('id')), {
                'title': ('title', {str}),
                'duration': ('duration', {float_or_none(scale=1000)}),
                'uploader': ('user', 'username', {str}),
                'uploader_url': ('user', 'permalink_url', {str_or_none}),
            }) or {})
        return result
