import { expect, test } from "bun:test";
import { createPcmDecoder } from "./pcm-decoder";

test('decoder rejects unsupported input before opening a worker', () => {
  const options = { position: 0, speed: 1, signal: new AbortController().signal };
  expect(() => createPcmDecoder({ type: 'load', playbackId: 'test', source: 'file:///private' }, options)).toThrow('HTTP audio source');
  expect(() => createPcmDecoder({ type: 'load', playbackId: 'test', source: 'https://example.com', headers: { Authorization: 'token\r\nInjected: value' } }, options)).toThrow('Invalid audio source headers');
  expect(() => createPcmDecoder({ type: 'load', playbackId: 'test', source: 'https://example.com' }, { ...options, speed: 0 })).toThrow('Invalid audio playback timing');
});

test('closing before the first read is idempotent and leaves the decoder cancelled', async () => {
  const decoder = createPcmDecoder({ type: 'load', playbackId: 'test', source: 'http://127.0.0.1:1/audio' }, { position: 0, speed: 1, signal: new AbortController().signal });
  await Promise.all([decoder.close(), decoder.close()]);
  await expect(decoder.read()).rejects.toThrow();
});

test('an already cancelled caller never starts usable decoding', async () => {
  const cancellation = new AbortController();
  cancellation.abort();
  const decoder = createPcmDecoder({ type: 'load', playbackId: 'test', source: 'http://127.0.0.1:1/audio' }, { position: 0, speed: 1, signal: cancellation.signal });
  await expect(decoder.read()).rejects.toThrow();
  await decoder.close();
});
