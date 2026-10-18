from yt_dlp.extractor.soundcloud import SoundcloudIE, SoundcloudSearchIE


# Original artwork needs a serial HEAD request per track. Couch displays the
# known JPEG sizes instead; stream extraction stays with yt-dlp.
class _CouchSoundcloudIE(SoundcloudIE, plugin_name='couch'):
    _ARTWORK_MAP = {key: size for key, size in SoundcloudIE._ARTWORK_MAP.items() if key != 'original'}


class _CouchSoundcloudSearchIE(SoundcloudSearchIE, plugin_name='couch'):
    _ARTWORK_MAP = _CouchSoundcloudIE._ARTWORK_MAP
