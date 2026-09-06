# ReplayGain native behavior

Source investigation for [Apply track or album ReplayGain with a tested clipping policy](https://github.com/avoid-quest/couch/issues/31). The issue owns requirements and acceptance. These notes describe the native capability and the limits the fixtures must verify.

## Modes and ownership

libmpv provides `replaygain=no|track|album`. Changes update the mixer without reloading. Album falls back to Track where album data is unavailable. Couch uses zero preamp, zero fallback gain, and `replaygain-clip=no`. The watching profile owns the saved Off/Track/Album choice; a current-item override ends with that item. Explicit Save as default derives the mode from native observations and changes the next item. This follows [the landed saved/current preference contract](https://github.com/avoid-quest/couch/issues/16#issuecomment-5555399472).

Sources: [mpv manual](https://mpv.io/manual/stable/#options-replaygain), [v0.37.0 mixer update options](https://github.com/mpv-player/mpv/blob/818ce7c51a6b9179307950e919983e0909942098/options/options.c#L688-L697).

## Peak limiting and missing data

With a usable peak, libmpv caps the linear ReplayGain multiplier at `1 / peak`. It does not scan the decoded samples or provide a true-peak limiter. Incorrect peaks can therefore permit clipping. R128-only metadata can have peak zero, which does not constrain amplification. Preamp and fallback remain zero so Off and missing ReplayGain data add no adjustment. Codec behavior such as Opus header gain remains separate.

Classic missing-peak behavior depends on the extraction path and native version. The mpv text parser assumes peak 1, allowing attenuation but preventing positive amplification. In v0.37.0, incomplete FFmpeg side data can instead produce gain 0 and peak 1 and suppress text fallback. Current mpv ignores unusable side data and can reach the text parser. Consequently a FLAC track gain of -6 dB without a peak can produce 0 dB in v0.37.0 and -6 dB in current mpv. Record the actual native version and capture this case.

Sources: [v0.37.0 side-data import](https://github.com/mpv-player/mpv/blob/818ce7c51a6b9179307950e919983e0909942098/demux/demux_lavf.c#L604-L653), [current side-data import](https://github.com/mpv-player/mpv/blob/876ba7b283400a2638826c8940c1bdb792d0ef0c/demux/demux_lavf.c#L634-L674), [text parsing and R128 conversion](https://github.com/mpv-player/mpv/blob/876ba7b283400a2638826c8940c1bdb792d0ef0c/demux/demux.c#L3092-L3156), [gain calculation](https://github.com/mpv-player/mpv/blob/876ba7b283400a2638826c8940c1bdb792d0ef0c/player/audio.c#L127-L193), [Opus decoder gain](https://github.com/FFmpeg/FFmpeg/blob/c6e28adabac09745f3406ffbf3833b8ac7f3f46a/libavcodec/opus/dec.c#L694-L699).

## Tag extraction

FFmpeg exports classic ReplayGain side data from native FLAC comments, Ogg Vorbis comments, and MP3 ID3v2 TXXX metadata. Opus comments also reach mpv's text parser, which recognizes classic, legacy and R128 keys. This is maintained native parsing; Couch does not copy raw gain/peak metadata into its shared state or resolve media in a controller.

Do not claim that all malformed tags are ignored. FFmpeg can turn nonnumeric gain text into 0 dB, while mpv's text parser rejects nonfinite values but accepts numeric prefixes. Extreme finite R128 values can overflow the computed mixer gain. Couch checks the native gain/peak numbers before enabling ReplayGain and leaves the item unadjusted if they are nonfinite, a peak is negative, or a gain would overflow the native float coefficient. This validates native output without adding another tag parser. Native qualification must retain parser/version distinctions instead of substituting predicted output for captures.

Sources: [FFmpeg FLAC](https://github.com/FFmpeg/FFmpeg/blob/c6e28adabac09745f3406ffbf3833b8ac7f3f46a/libavformat/flacdec.c#L197-L226), [Vorbis](https://github.com/FFmpeg/FFmpeg/blob/c6e28adabac09745f3406ffbf3833b8ac7f3f46a/libavformat/oggparsevorbis.c#L418-L424), [MP3](https://github.com/FFmpeg/FFmpeg/blob/c6e28adabac09745f3406ffbf3833b8ac7f3f46a/libavformat/mp3dec.c#L442-L482), [Opus](https://github.com/FFmpeg/FFmpeg/blob/c6e28adabac09745f3406ffbf3833b8ac7f3f46a/libavformat/oggparseopus.c#L101-L106), [FFmpeg classic parser](https://github.com/FFmpeg/FFmpeg/blob/e38092ef9395d7049f871ef4d5411eb410e283e0/libavformat/replaygain.c#L38-L107), [mpv numeric parser](https://github.com/mpv-player/mpv/blob/818ce7c51a6b9179307950e919983e0909942098/demux/demux.c#L2852-L2900).

## Evidence boundaries

The fixture generator writes deterministic PCM references, tagged/untagged files, cover art and tagged video with hashes. Its expected values are predictions. Native tests must check current changes, preload, replacement, Stop, radio/video exclusion and cover-art eligibility. Actual Couch playback must produce separate float audio captures, measured gains and peak counts, plus profile persistence and two-controller evidence. A digital sink capture does not qualify physical speakers or a TV.
