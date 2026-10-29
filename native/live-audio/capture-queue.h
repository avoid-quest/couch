/* Couch's timestamped PCM producer. PortAudio owns native capture and its ring. */
#ifndef COUCH_CAPTURE_QUEUE_H
#define COUCH_CAPTURE_QUEUE_H
#include <math.h>
#include <stdint.h>
#include <stdatomic.h>
#include <string.h>
#include "portaudio.h"
#include "pa_ringbuffer.h"

// Callbacks are fixed at the requested 128-1024 frames. 256 slots (about 0.7 s at 128
// frames) let the non-realtime writer be descheduled while the system is busy.
#define CAPTURE_MAX_FRAMES 1024
#define CAPTURE_QUEUE_SIZE 256
enum CaptureError { CAPTURE_OK, CAPTURE_XRUN, CAPTURE_NULL_INPUT, CAPTURE_FORMAT,
                    CAPTURE_CLOCK, CAPTURE_QUEUE_FULL, CAPTURE_NONFINITE };
typedef struct { uint32_t bytes; unsigned char wire[40 + CAPTURE_MAX_FRAMES * 8]; } CapturePacket;
typedef struct {
    PaUtilRingBuffer ring;
    CapturePacket slots[CAPTURE_QUEUE_SIZE];
    atomic_int error;
    uint32_t rate, channels, sequence, previousFrames, minFrames, maxFrames;
    uint64_t position;
    double previousAdcTime;
    double observedAdcTime, observedDeltaFrames;
    unsigned long observedFrames, observedFlags;
    uint32_t timestampDeviationCount;
    double maxTimestampDeviationFrames;
} CaptureQueue;

static void capture_le(unsigned char *to, uint64_t value, unsigned bytes) {
    for (unsigned i = 0; i < bytes; i++) to[i] = (unsigned char)(value >> (i * 8));
}
static int capture_queue_init(CaptureQueue *q, uint32_t rate, unsigned channels) {
    memset(q, 0, sizeof(*q));
    atomic_init(&q->error, CAPTURE_OK);
    q->rate = rate; q->channels = channels;
    return (channels == 1 || channels == 2) && atomic_is_lock_free(&q->error) &&
        PaUtil_InitializeRingBuffer(&q->ring, sizeof(CapturePacket), CAPTURE_QUEUE_SIZE, q->slots) == 0;
}
static int capture_failed(CaptureQueue *q, enum CaptureError reason) {
    atomic_store(&q->error, reason);
    return paAbort;
}
static int capture_callback(const void *input, void *output, unsigned long frames,
                            const PaStreamCallbackTimeInfo *time,
                            PaStreamCallbackFlags flags, void *user) {
    CaptureQueue *q = user;
    (void)output;
    q->observedFrames = frames; q->observedFlags = flags;
    q->observedAdcTime = time && isfinite(time->inputBufferAdcTime) ? time->inputBufferAdcTime : 0;
    q->observedDeltaFrames = q->sequence ? (q->observedAdcTime - q->previousAdcTime) * q->rate - q->previousFrames : 0;
    if (atomic_load(&q->error)) return paAbort;
    if (flags & (paInputUnderflow | paInputOverflow)) return capture_failed(q, CAPTURE_XRUN);
    if (!input) return capture_failed(q, CAPTURE_NULL_INPUT);
    if (!frames || frames > CAPTURE_MAX_FRAMES || q->sequence == UINT32_MAX)
        return capture_failed(q, CAPTURE_FORMAT);
    if (!time || !isfinite(time->inputBufferAdcTime) || time->inputBufferAdcTime <= 0 ||
        time->inputBufferAdcTime >= (double)INT64_MAX / 1e6 ||
        (q->sequence && time->inputBufferAdcTime <= q->previousAdcTime))
        return capture_failed(q, CAPTURE_CLOCK);
    /* CoreAudio's host-time estimate can step while native sample positions stay
     * continuous. Preserve it, report deviations, and let Core validate clock
     * drift; timestamp spacing alone is not evidence of a missing sample. */
    if (q->sequence && fabs(q->observedDeltaFrames) > 2) q->timestampDeviationCount++;
    if (fabs(q->observedDeltaFrames) > q->maxTimestampDeviationFrames) q->maxTimestampDeviationFrames = fabs(q->observedDeltaFrames);
    const float *pcm = input;
    for (unsigned long i = 0; i < frames * q->channels; i++)
        if (!isfinite(pcm[i])) return capture_failed(q, CAPTURE_NONFINITE);
    void *first, *second;
    ring_buffer_size_t n1, n2;
    if (PaUtil_GetRingBufferWriteRegions(&q->ring, 1, &first, &n1, &second, &n2) != 1)
        return capture_failed(q, CAPTURE_QUEUE_FULL);
    CapturePacket *packet = first;
    unsigned char *wire = packet->wire;
    memset(wire, 0, 40);
    capture_le(wire, 0x31414343, 4); wire[4] = (unsigned char)q->channels; wire[5] = 1;
    capture_le(wire + 6, 40, 2); capture_le(wire + 8, q->rate, 4);
    capture_le(wire + 12, q->sequence, 4); capture_le(wire + 16, q->position, 8);
    capture_le(wire + 24, (uint64_t)llround(time->inputBufferAdcTime * 1e6), 8);
    capture_le(wire + 32, frames, 4);
    memcpy(wire + 40, input, frames * q->channels * 4); /* Supported targets are little endian IEEE float32. */
    packet->bytes = 40 + (uint32_t)frames * q->channels * 4;
    q->previousAdcTime = time->inputBufferAdcTime; q->previousFrames = (uint32_t)frames;
    q->position += frames;
    if (!q->sequence || frames < q->minFrames) q->minFrames = (uint32_t)frames;
    if (frames > q->maxFrames) q->maxFrames = (uint32_t)frames;
    q->sequence++;
    PaUtil_AdvanceRingBufferWriteIndex(&q->ring, 1);
    return paContinue;
}
#endif
