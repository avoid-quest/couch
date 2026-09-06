# Cue fixtures

`album.flac` is an 18-second, mono, 44,100 Hz, signed 16-bit FLAC made for Couch. It contains three generated tones, with transitions at 5 1/3 and 11 2/3 seconds. `album.cue` uses the corresponding 75-frame timestamps. Expected track durations are 5 1/3, 6 1/3, and 6 1/3 seconds. The last track ends at the audio file's measured duration.

The fixture contains no third-party recording. It tests decoded file and segment behavior. It does not qualify physical audio output or gapless transitions.

Generated with FFmpeg 7.1 for macOS aarch64, binary SHA-256 `6d175a4743ca50256e89a8cdd731100f9cee33bd79aeea46894d209410dc6617`:

```sh
ffmpeg -hide_banner -loglevel error -f lavfi \
  -i "aevalsrc='0.15*sin(2*PI*if(lt(t,16/3),330,if(lt(t,35/3),550,770))*t)':s=44100:d=18" \
  -ac 1 -c:a flac -sample_fmt s16 \
  -metadata title='Three tones source' -metadata artist='Couch fixture' \
  -metadata album='Three tones' album.flac
```

Audio file SHA-256: `9bef545bd3b3756376dd65db6b1b4118ed5782012dfd317ef0170096a3910b29`.

The other cue files exercise invalid frame numbers, a missing source, multiple FILE directives, and INDEX 00 pregaps. Tests create temporary copies before changing paths or content.

`short.wav` checks the other supported container and an EOF between cue frames. Its 9,001 samples last exactly `9001 / 44100` seconds, which cannot be expressed as a whole number of 75 Hz cue frames. The same FFmpeg binary generated it with:

```sh
ffmpeg -hide_banner -loglevel error -f lavfi \
  -i 'sine=frequency=440:sample_rate=44100:duration=0.3' \
  -af atrim=end_sample=9001 -c:a pcm_s16le short.wav
```
