/* Mac host capture: PortAudio backend, existing Couch PCM wire format.
 * No network credentials, device-default changes, monitoring or rate conversion.
 * Control: clock <nonce>, start, stop on stdin. PCM on stdout; JSON on stderr.
 */
#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>
#include "pa_mac_core.h"
#include "capture-queue.h"

static CaptureQueue queue;
static volatile sig_atomic_t interrupted;
static atomic_int rateNotified;
static void interrupt_capture(int sig) { (void)sig; interrupted = 1; }
static OSStatus property(AudioDeviceID id, AudioObjectPropertySelector selector, UInt32 size, void *value) {
    AudioObjectPropertyAddress address = {selector, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
    return AudioObjectGetPropertyData(id, &address, 0, NULL, &size, value);
}
static OSStatus device_changed(AudioObjectID id, UInt32 count, const AudioObjectPropertyAddress *addresses, void *user) {
    (void)id; (void)count; (void)addresses; (void)user;
    atomic_store(&queue.error, CAPTURE_FORMAT);
    return noErr;
}
static int number(const char *text, unsigned long *result) {
    char *end; errno = 0;
    if (!*text || *text == '-') return 0;
    *result = strtoul(text, &end, 10);
    return !errno && !*end;
}
static AudioDeviceID device_uid(const char *text) {
    CFStringRef uid = CFStringCreateWithCString(NULL, text, kCFStringEncodingUTF8);
    if (!uid) return kAudioObjectUnknown;
    AudioDeviceID device = kAudioObjectUnknown;
    AudioObjectPropertyAddress address = {kAudioHardwarePropertyTranslateUIDToDevice, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
    UInt32 bytes = sizeof(device);
    OSStatus status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, sizeof(uid), &uid, &bytes, &device);
    CFRelease(uid);
    return status ? kAudioObjectUnknown : device;
}
static int nonblocking(int fd) {
    int flags = fcntl(fd, F_GETFL);
    return flags >= 0 && fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0;
}
static unsigned input_channels(AudioDeviceID device) {
    AudioObjectPropertyAddress address = {kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyScopeInput, kAudioObjectPropertyElementMain};
    UInt32 bytes = 0;
    if (AudioObjectGetPropertyDataSize(device, &address, 0, NULL, &bytes) || bytes < sizeof(AudioBufferList) || bytes > 65536) return 0;
    AudioBufferList *buffers = malloc(bytes);
    if (!buffers) return 0;
    unsigned channels = 0;
    if (!AudioObjectGetPropertyData(device, &address, 0, NULL, &bytes, buffers))
        for (UInt32 i = 0; i < buffers->mNumberBuffers; i++) channels += buffers->mBuffers[i].mNumberChannels;
    free(buffers); return channels;
}
static OSStatus rate_changed(AudioObjectID id, UInt32 count, const AudioObjectPropertyAddress *addresses, void *user) {
    (void)id; (void)count; (void)addresses; (void)user;
    atomic_store(&rateNotified, 1); return noErr;
}
static double monotonic_seconds(void) {
    struct timespec now; clock_gettime(CLOCK_MONOTONIC, &now);
    return now.tv_sec + now.tv_nsec / 1e9;
}
static int set_rate(AudioDeviceID device, Float64 requested) {
    AudioObjectPropertyAddress address = {kAudioDevicePropertyAvailableNominalSampleRates, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
    UInt32 bytes = 0;
    if (AudioObjectGetPropertyDataSize(device, &address, 0, NULL, &bytes) || bytes > 65536 || bytes % sizeof(AudioValueRange)) return 0;
    AudioValueRange *rates = malloc(bytes); int supported = 0;
    if (!rates) return 0;
    if (!AudioObjectGetPropertyData(device, &address, 0, NULL, &bytes, rates))
        for (unsigned i = 0; i < bytes / sizeof(*rates); i++) if (requested >= rates[i].mMinimum && requested <= rates[i].mMaximum) supported = 1;
    free(rates);
    address.mSelector = kAudioDevicePropertyNominalSampleRate;
    Boolean writable = false;
    if (!supported || AudioObjectIsPropertySettable(device, &address, &writable) || !writable) return 0;
    atomic_store(&rateNotified, 0);
    if (!atomic_is_lock_free(&rateNotified) || AudioObjectAddPropertyListener(device, &address, rate_changed, NULL)) return 0;
    OSStatus status = AudioObjectSetPropertyData(device, &address, 0, NULL, sizeof(requested), &requested);
    double deadline = monotonic_seconds() + 3;
    int success = 0;
    while (!status && !interrupted && monotonic_seconds() < deadline) {
        Float64 actual = 0;
        if (atomic_load(&rateNotified) && !property(device, address.mSelector, sizeof(actual), &actual) && actual == requested) { success = 1; break; }
        usleep(1000);
    }
    AudioObjectRemovePropertyListener(device, &address, rate_changed, NULL);
    return success;
}
static void quoted(const char *value) {
    putchar('"');
    for (const unsigned char *p = (const unsigned char *)value; *p; p++) {
        if (*p == '"' || *p == '\\') { putchar('\\'); putchar(*p); }
        else if (*p < 32) printf("\\u%04x", *p);
        else putchar(*p);
    }
    putchar('"');
}
/* Discovery opens no stream and never changes the default device. */
static int list_devices(void) {
    if (Pa_Initialize() != paNoError) return 1;
    AudioObjectPropertyAddress address = {kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
    UInt32 bytes = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, NULL, &bytes)) { Pa_Terminate(); return 1; }
    AudioDeviceID *devices = malloc(bytes);
    if (!devices || AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, NULL, &bytes, devices)) { free(devices); Pa_Terminate(); return 1; }
    int printed = 0;
    putchar('[');
    for (unsigned i = 0; i < bytes / sizeof(*devices); i++) {
        if (input_channels(devices[i]) < 2) continue;
        CFStringRef name = NULL, uid = NULL;
        char label[1024], id[1024]; Float64 rate = 0; UInt32 frames = 0;
        if (property(devices[i], kAudioObjectPropertyName, sizeof(name), &name) ||
            property(devices[i], kAudioDevicePropertyDeviceUID, sizeof(uid), &uid) ||
            !name || !uid || !CFStringGetCString(name, label, sizeof(label), kCFStringEncodingUTF8) ||
            !CFStringGetCString(uid, id, sizeof(id), kCFStringEncodingUTF8) ||
            property(devices[i], kAudioDevicePropertyNominalSampleRate, sizeof(rate), &rate) ||
            property(devices[i], kAudioDevicePropertyBufferFrameSize, sizeof(frames), &frames)) {
            if (name) CFRelease(name); if (uid) CFRelease(uid); continue;
        }
        CFRelease(name); CFRelease(uid);
        int matches = 0, channels = 0;
        for (PaDeviceIndex p = 0, n = Pa_GetDeviceCount(); p < n; p++) {
            const PaDeviceInfo *device = Pa_GetDeviceInfo(p);
            if (Pa_GetHostApiInfo(device->hostApi)->type == paCoreAudio && device->maxInputChannels >= 2 && !strcmp(device->name, label)) { matches++; channels = device->maxInputChannels; }
        }
        if (matches != 1 || (rate != 44100 && rate != 48000)) continue;
        if (printed++) putchar(',');
        fputs("{\"uid\":", stdout); quoted(id); fputs(",\"name\":", stdout); quoted(label);
        printf(",\"channels\":%d,\"nominalRate\":%.0f,\"ownerHalBufferFrames\":%u}", channels, rate, frames);
    }
    puts("]"); free(devices); Pa_Terminate(); return 0;
}
int main(int argc, char **argv) {
    if (argc == 2 && !strcmp(argv[1], "--list")) return list_devices();
    unsigned long rate, frames, seconds;
    if ((argc != 6 && argc != 7) || (argc == 7 && strcmp(argv[6], "--set-rate")) || !number(argv[3], &rate) || !number(argv[4], &frames) || !number(argv[5], &seconds) ||
        (rate != 48000 && rate != 44100) || (frames != 128 && frames != 256 && frames != 512 && frames != 1024) ||
        seconds > 300) {
        fputs("Usage: capture --list | <exact name> <CoreAudio UID> <44100|48000> <128|256|512|1024> <0..300 seconds; 0 = owner lifetime> [--set-rate]\n", stderr);
        return 2;
    }
    uint32_t endian = 1;
    if (*(unsigned char *)&endian != 1 || sizeof(float) != 4 || !capture_queue_init(&queue, (uint32_t)rate)) return 2;
    signal(SIGINT, interrupt_capture); signal(SIGTERM, interrupt_capture); signal(SIGPIPE, SIG_IGN);
    setvbuf(stderr, NULL, _IONBF, 0);
    PaError error = Pa_Initialize();
    if (error != paNoError) { fprintf(stderr, "{\"event\":\"initialize-error\",\"code\":%d}\n", error); return 1; }
    PaStream *stream = NULL;
    int result = 1, started = 0, listeners = 0;
    const char *failure = "device";
    AudioDeviceID native = device_uid(argv[2]);
    Float64 nominal = 0, previousRate = 0;
    UInt32 bufferFrames = 0;
    AudioObjectPropertyAddress properties[] = {
        {kAudioDevicePropertyNominalSampleRate, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain},
        {kAudioDevicePropertyDeviceIsAlive, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain}
    };
    /* No fallback to a default microphone or silent resampling to another rate. */
    if (!native || input_channels(native) < 2 || property(native, kAudioDevicePropertyNominalSampleRate, sizeof(nominal), &nominal)) goto done;
    CFStringRef nativeName = NULL;
    char nativeLabel[1024];
    if (property(native, kAudioObjectPropertyName, sizeof(nativeName), &nativeName) || !nativeName) goto done;
    int sameName = CFStringGetCString(nativeName, nativeLabel, sizeof(nativeLabel), kCFStringEncodingUTF8) && !strcmp(nativeLabel, argv[1]);
    CFRelease(nativeName);
    if (!sameName) goto done;
    previousRate = nominal;
    PaDeviceIndex selected = paNoDevice;
    int matches = 0;
    for (PaDeviceIndex i = 0, n = Pa_GetDeviceCount(); i < n; i++) {
        const PaDeviceInfo *device = Pa_GetDeviceInfo(i);
        const PaHostApiInfo *api = Pa_GetHostApiInfo(device->hostApi);
        if (api->type == paCoreAudio && device->maxInputChannels >= 2 && !strcmp(device->name, argv[1])) { selected = i; matches++; }
    }
    if (matches != 1) goto done;
    failure = "device-rate";
    if (nominal != rate && (argc != 7 || !set_rate(native, rate))) goto done;
    for (; listeners < 2; listeners++)
        if (AudioObjectAddPropertyListener(native, &properties[listeners], device_changed, NULL)) goto done;
    PaMacCoreStreamInfo info;
    PaMacCore_SetupStreamInfo(&info, paMacCorePlayNice);
    PaStreamParameters input = {selected, 2, paFloat32, (double)frames / rate, &info};
    error = Pa_OpenStream(&stream, &input, NULL, (double)rate, frames, paDitherOff, capture_callback, &queue);
    failure = "open";
    if (error != paNoError) goto done;
    failure = "readback";
    const PaStreamInfo *actual = Pa_GetStreamInfo(stream);
    if (!actual || actual->sampleRate != rate || PaMacCore_GetStreamInputDevice(stream) != native ||
        property(native, kAudioDevicePropertyNominalSampleRate, sizeof(nominal), &nominal) || nominal != rate ||
        property(native, kAudioDevicePropertyBufferFrameSize, sizeof(bufferFrames), &bufferFrames)) goto done;
    if (!nonblocking(STDIN_FILENO) || !nonblocking(STDOUT_FILENO)) { failure = "pipe"; goto done; }
    // Node gives stdout a Unix socketpair: about 2.6 s of 128-frame packets ride out a busy Main.
    (void)setsockopt(STDOUT_FILENO, SOL_SOCKET, SO_SNDBUF, &(int){1 << 20}, sizeof(int));
    fprintf(stderr, "{\"event\":\"ready\",\"sampleRate\":%lu,\"channels\":2,\"format\":\"f32le\",\"requestedCallbackFrames\":%lu,\"ownerHalBufferFrames\":%u,\"nominalRate\":%.0f,\"previousNominalRate\":%.0f,\"reportedInputLatencyMs\":%.6f,\"timestampConvention\":\"PortAudio ADC estimate\"}\n",
            rate, frames, bufferFrames, nominal, previousRate, actual->inputLatency * 1000);
    double deadline = seconds ? Pa_GetStreamTime(stream) + seconds : INFINITY;
    char command[128]; size_t commandBytes = 0, sent = 0;
    while (!interrupted && Pa_GetStreamTime(stream) < deadline) {
        if (atomic_load(&queue.error)) { failure = "capture"; goto done; }
        if (started && (error = Pa_IsStreamActive(stream)) != 1) { failure = "stream-ended"; goto done; }
        void *first, *second; ring_buffer_size_t n1, n2;
        int available = PaUtil_GetRingBufferReadRegions(&queue.ring, 1, &first, &n1, &second, &n2) == 1;
        struct pollfd fds[] = {{STDIN_FILENO, POLLIN, 0}, {STDOUT_FILENO, available ? POLLOUT : 0, 0}};
        int polled = poll(fds, 2, 1);
        if (polled < 0 && errno != EINTR) { failure = "poll"; goto done; }
        if (fds[0].revents & (POLLIN | POLLHUP)) {
            char data[128]; ssize_t count = read(STDIN_FILENO, data, sizeof(data));
            if (count == 0) { result = 0; failure = "owner-closed"; goto done; }
            if (count < 0 && errno != EAGAIN && errno != EINTR) { failure = "command-read"; goto done; }
            for (ssize_t i = 0; i < count; i++) {
                if (data[i] != '\n') {
                    if (commandBytes == sizeof(command) - 1) { failure = "command-length"; goto done; }
                    command[commandBytes++] = data[i]; continue;
                }
                command[commandBytes] = 0; commandBytes = 0;
                unsigned long nonce;
                if (!strncmp(command, "clock ", 6) && number(command + 6, &nonce) && nonce <= UINT32_MAX) {
                    fprintf(stderr, "{\"event\":\"clock\",\"nonce\":%lu,\"nativeUs\":%.0f}\n", nonce, Pa_GetStreamTime(stream) * 1e6);
                } else if (!strcmp(command, "start") && !started) {
                    failure = "start"; error = Pa_StartStream(stream);
                    if (error != paNoError) goto done;
                    started = 1;
                    if (property(native, kAudioDevicePropertyBufferFrameSize, sizeof(bufferFrames), &bufferFrames)) { failure = "running-readback"; goto done; }
                    fprintf(stderr, "{\"event\":\"started\",\"ownerHalBufferFrames\":%u}\n", bufferFrames);
                } else if (!strcmp(command, "stop")) { result = 0; failure = "stopped"; goto done; }
                else { failure = "command"; goto done; }
            }
        }
        if (available && (fds[1].revents & POLLOUT)) {
            CapturePacket *packet = first;
            ssize_t count = write(STDOUT_FILENO, packet->wire + sent, packet->bytes - sent);
            if (count < 0 && errno != EAGAIN && errno != EINTR) { failure = "pcm-write"; goto done; }
            if (count > 0) sent += (size_t)count;
            if (sent == packet->bytes) { PaUtil_AdvanceRingBufferReadIndex(&queue.ring, 1); sent = 0; }
        }
        if ((fds[0].revents | fds[1].revents) & (POLLERR | POLLNVAL) || (fds[1].revents & POLLHUP)) { failure = "pipe-closed"; goto done; }
    }
    failure = interrupted ? "interrupted" : "deadline";
done:
    if (stream) { if (Pa_IsStreamActive(stream) == 1) Pa_AbortStream(stream); Pa_CloseStream(stream); }
    for (int i = 0; i < listeners; i++) AudioObjectRemovePropertyListener(native, &properties[i], device_changed, NULL);
    Pa_Terminate();
    fprintf(stderr, "{\"event\":\"end\",\"reason\":\"%s\",\"exit\":%d,\"portAudioStatus\":%d,\"captureError\":%d,\"callbacks\":%u,\"frames\":%llu,\"minCallbackFrames\":%u,\"maxCallbackFrames\":%u,\"observedFrames\":%lu,\"observedFlags\":%lu,\"observedAdcTime\":%.9f,\"observedDeltaFrames\":%.9f,\"timestampDeviationCount\":%u,\"maxTimestampDeviationFrames\":%.9f}\n",
            failure, result, error, atomic_load(&queue.error), queue.sequence, (unsigned long long)queue.position, queue.minFrames, queue.maxFrames,
            queue.observedFrames, queue.observedFlags, queue.observedAdcTime, isfinite(queue.observedDeltaFrames) ? queue.observedDeltaFrames : 0,
            queue.timestampDeviationCount, queue.maxTimestampDeviationFrames);
    return result;
}
