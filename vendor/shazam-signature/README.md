# Shazam fingerprinting

`src/server/shazam-signature.ts` and `src/server/shazam-hanning.ts` are a narrow TypeScript port of the MIT-licensed [shazamio-core](https://github.com/shazamio/shazamio-core) fingerprinting implementation at commit [`d7608768ab274c1b149f0d9086b75db2e661b9bb`](https://github.com/shazamio/shazamio-core/tree/d7608768ab274c1b149f0d9086b75db2e661b9bb).

The port follows `src/fingerprinting/algorithm.rs`, `signature_format.rs`, `communication.rs` and the exact rounded coefficients in `hanning.rs`. Its upstream MIT notice is retained in [LICENSE](LICENSE). Couch uses the MIT-licensed `fft.js` package for the FFT; no code was copied from the GPL TypeScript Shazam clients.

The recognition HTTP request in `src/server/song-recognition.ts` follows the MIT-licensed [ShazamIO](https://github.com/shazamio/ShazamIO) `api.py` and `misc.py` at commit [`f94faafdabff9cdec258f3ac024a6402989e9040`](https://github.com/shazamio/ShazamIO/tree/f94faafdabff9cdec258f3ac024a6402989e9040). Its copyright notice is also retained in LICENSE. No Python runtime or ShazamIO package is installed or shipped by Couch.

The combined MIT notice, including `fft.js`'s copyright, also appears in an `@license` comment in `shazam-signature.ts` so the Core bundle retains it in packaged builds.

Couch supplies at most 12 seconds of mono, 16 kHz, signed 16-bit little-endian PCM. FFmpeg already handles stream access, decoding and resampling. The port covers only spectral peak extraction and signature encoding; it contains no audio decoder or song catalog. Recognition still requires Shazam's remote service.

The window coefficients and intermediate power/peak calculations retain the upstream float32 precision. The FFT implementation is different, so fingerprints can differ slightly at quantization boundaries. Generation yields to Core's event loop every 128 FFT frames and honors cancellation.

`tests/shazam-signature.test.ts` generates four synthetic chirps covering every frequency band. The reference peaks were recorded with `shazamio-core==2.0.0`, `Recognizer().recognize_path(wav, SearchParams(segment_duration_seconds=12))`, using a WAV containing those exact PCM samples. Its public API runs a sinc resampler even on 16 kHz input, introducing low-magnitude quantization peaks; the comparison uses the 32 strong peaks and allows one FFT frame, two encoded frequency units and two magnitude units of variation. The test separately checks header fields, CRC32, the input bound, silence and cancellation. No copyrighted audio fixture is committed.

A separate live check used the upstream ShazamIO public `examples/data/Gloria.ogg` sample, decoded to an exact 12-second PCM excerpt with FFmpeg. Shazam recognized the TypeScript-generated signature as **I Will Survive — Gloria Gaynor** (track `53982678`). This is a smoke check, not a measured recognition-accuracy claim.
