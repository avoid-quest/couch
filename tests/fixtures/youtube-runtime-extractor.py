import json
from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.extractor.youtube import YoutubeIE


class CouchRuntimeTestIE(InfoExtractor):
    _VALID_URL = r'couchruntime:(?P<id>node|quickjs)'

    def _real_extract(self, url):
        expected = self._match_id(url)
        youtube = YoutubeIE(self._downloader)
        youtube.initialize()
        providers = {p.PROVIDER_NAME: p for p in youtube._jsc_director.providers.values()}
        runtime = providers['node'] if providers['node'].is_available() else providers['quickjs']
        assert runtime.PROVIDER_NAME == expected
        if expected == 'node':
            result = json.loads(runtime._run_js_runtime('console.log(JSON.stringify({version: process.versions.node, read: process.permission.has("fs.read"), spawn: process.permission.has("child")}))'))
            assert int(result['version'].split('.')[0]) >= 22
            assert not result['read'] and not result['spawn'], 'Keep yt-dlp Node permission restrictions'
        else:
            assert runtime._run_js_runtime('console.log("quickjs fallback")').strip() == 'quickjs fallback'
        return {'id': expected, 'title': expected, 'url': 'https://media.example/fixture.mp4'}
