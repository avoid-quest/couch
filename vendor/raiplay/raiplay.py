from yt_dlp.extractor.rai import RaiPlayIE


class _CouchRaiPlayIE(RaiPlayIE, plugin_name='couch'):
    # Keep the provider's timed-image descriptor from the XML upstream already
    # downloads. Stream selection, DRM and regional availability stay upstream.
    def _download_xml(self, *args, **kwargs):
        document = super()._download_xml(*args, **kwargs)
        if document is not None and kwargs.get('query', {}).get('output') == 64:
            self._couch_preview_vtt = document.findtext('./vtt_poster_thumbs_url')
        return document

    def _extract_relinker_info(self, *args, **kwargs):
        self._couch_preview_vtt = None
        info = super()._extract_relinker_info(*args, **kwargs)
        descriptor = (self._couch_preview_vtt or '').strip()
        if descriptor and not info.get('is_live'):
            info['couch_preview_vtt'] = descriptor
        return info
