#include <assert.h>
#include <stdio.h>
#include "capture-queue.h"
static CaptureQueue q;
static float pcm[CAPTURE_MAX_FRAMES * 2];
static uint64_t number(const unsigned char *p, unsigned n) {
    uint64_t v = 0; for (unsigned i = 0; i < n; i++) v |= (uint64_t)p[i] << (8 * i); return v;
}
static int push(unsigned frames, double adc, PaStreamCallbackFlags flags) {
    PaStreamCallbackTimeInfo t = { .inputBufferAdcTime = adc };
    return capture_callback(pcm, NULL, frames, &t, flags, &q);
}
int main(void) {
    assert(capture_queue_init(&q, 48000, 2));
    for (unsigned i = 0; i < 128 * 2; i++) pcm[i] = (float)i / 512;
    /* Wrap the bounded ring repeatedly; bytes and ADC timestamps must survive. */
    for (unsigned i = 0; i < 100; i++) {
        assert(push(128, 100 + (double)i * 128 / 48000, 0) == paContinue);
        CapturePacket p;
        assert(PaUtil_ReadRingBuffer(&q.ring, &p, 1) == 1);
        assert(p.bytes == 1064 && number(p.wire, 4) == 0x31414343);
        assert(number(p.wire + 12, 4) == i && number(p.wire + 16, 8) == i * 128);
        assert(number(p.wire + 24, 8) == (uint64_t)llround((100 + (double)i * 128 / 48000) * 1e6));
        assert(memcmp(p.wire + 40, pcm, 128 * 8) == 0);
    }
    assert(capture_queue_init(&q, 48000, 2));
    for (unsigned i = 0; i < CAPTURE_QUEUE_SIZE; i++) assert(push(128, 100 + (double)i * 128 / 48000, 0) == paContinue);
    assert(push(128, 100 + (double)CAPTURE_QUEUE_SIZE * 128 / 48000, 0) == paAbort);
    assert(atomic_load(&q.error) == CAPTURE_QUEUE_FULL && q.position == 128 * CAPTURE_QUEUE_SIZE);
    /* A host-time estimate adjustment does not establish skipped samples. Keep
     * the timestamp byte-for-byte (integer microseconds), without repairing it. */
    assert(capture_queue_init(&q, 48000, 2)); assert(push(256, 100, 0) == paContinue);
    double adjusted = 100 + 256.0 / 48000 + .0003;
    assert(push(256, adjusted, 0) == paContinue);
    CapturePacket pair[2]; assert(PaUtil_ReadRingBuffer(&q.ring, pair, 2) == 2);
    assert(number(pair[1].wire + 24, 8) == (uint64_t)llround(adjusted * 1e6));
    assert(q.timestampDeviationCount == 1 && fabs(q.maxTimestampDeviationFrames - 14.4) < .001);
    /* Backward/duplicate time and an explicit driver xrun still stop capture. */
    for (unsigned scenario = 0; scenario < 3; scenario++) {
        assert(capture_queue_init(&q, 48000, 2)); assert(push(128, 100, 0) == paContinue);
        assert(push(128, scenario == 0 ? 99 : 100, scenario == 2 ? paInputOverflow : 0) == paAbort);
        assert(q.position == 128 && q.sequence == 1);
    }
    assert(capture_queue_init(&q, 48000, 2));
    assert(capture_callback(NULL, NULL, 128, NULL, 0, &q) == paAbort);
    assert(atomic_load(&q.error) == CAPTURE_NULL_INPUT);
    assert(capture_queue_init(&q, 48000, 2));
    assert(push(CAPTURE_MAX_FRAMES + 1, 100, 0) == paAbort);
    assert(capture_queue_init(&q, 48000, 2)); pcm[1] = NAN;
    assert(push(128, 100, 0) == paAbort && atomic_load(&q.error) == CAPTURE_NONFINITE);
    /* Mono carries one real channel, with the same frame clock and no duplication. */
    assert(!capture_queue_init(&q, 48000, 0));
    assert(!capture_queue_init(&q, 48000, 3));
    assert(capture_queue_init(&q, 48000, 1));
    for (unsigned i = 0; i < 128; i++) pcm[i] = (float)i / 512;
    pcm[128] = NAN; /* Samples outside the selected channel are never read. */
    assert(push(128, 100, 0) == paContinue);
    CapturePacket mono;
    assert(PaUtil_ReadRingBuffer(&q.ring, &mono, 1) == 1);
    assert(mono.wire[4] == 1 && mono.bytes == 40 + 128 * 4);
    assert(memcmp(mono.wire + 40, pcm, 128 * 4) == 0 && q.position == 128);
    assert(push(64, 100 + 128.0 / 48000, 0) == paContinue);
    assert(PaUtil_ReadRingBuffer(&q.ring, &mono, 1) == 1);
    assert(number(mono.wire + 16, 8) == 128 && number(mono.wire + 32, 4) == 64);
    puts("capture queue: ordering, wrap, overflow, discontinuity, xrun and invalid input passed");
}
