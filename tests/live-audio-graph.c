// Private JACK graph for the audio lab. Source and every output are recorded in
// one process callback/sample clock. No filesystem I/O or allocation in callbacks.
// stdout: interleaved native float32 [reference, receiver0, ...]. SIGUSR1 starts.
#include <jack/jack.h>
#include <jack/ringbuffer.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static jack_client_t *source_client, *recorder_client, *delay_client;
static jack_port_t *source_port, *inputs[101], *delay_input, *delay_outputs[3];
static jack_ringbuffer_t *records;
static float *signal_pcm, *block, *delay_line;
static size_t signal_frames, source_at, record_at, total_frames, delay_at;
static unsigned channels;
static volatile sig_atomic_t started, stopped;
static atomic_int finished, overflow, xruns;
static jack_time_t began_us;
static double graph_deviation_us;
static const unsigned delays[] = {960, 3840, 7200}; // 20/80/150 ms at 48 kHz.

static void start(int value) { (void)value; started = 1; }
static void stop(int value) { (void)value; stopped = 1; }
static int xrun(void *data) { (void)data; if (started) atomic_fetch_add(&xruns, 1); return 0; }
static int generate(jack_nframes_t count, void *data) {
  (void)data;
  float *output = jack_port_get_buffer(source_port, count);
  for (unsigned frame = 0; frame < count; frame++)
    output[frame] = started && source_at < signal_frames ? signal_pcm[source_at++] : 0;
  return 0;
}
static int delay(jack_nframes_t count, void *data) {
  (void)data;
  float *input = jack_port_get_buffer(delay_input, count), *outputs[3];
  for (unsigned channel = 0; channel < 3; channel++) outputs[channel] = jack_port_get_buffer(delay_outputs[channel], count);
  for (unsigned frame = 0; frame < count; frame++, delay_at++) {
    delay_line[delay_at % 8192] = input[frame];
    for (unsigned channel = 0; channel < 3; channel++)
      outputs[channel][frame] = delay_at >= delays[channel] ? delay_line[(delay_at - delays[channel]) % 8192] : 0;
  }
  return 0;
}
static int record(jack_nframes_t count, void *data) {
  (void)data;
  if (!started || atomic_load(&finished)) return 0;
  jack_time_t now = jack_get_time();
  if (!record_at) began_us = now;
  double deviation = (double)(now - began_us) - (double)record_at * 1000000.0 / 48000.0;
  if (deviation < 0) deviation = -deviation;
  if (deviation > graph_deviation_us) graph_deviation_us = deviation;
  if (count > 4096) { atomic_store(&overflow, 1); atomic_store(&finished, 1); return 0; }
  size_t frames = total_frames - record_at < count ? total_frames - record_at : count;
  for (unsigned channel = 0; channel < channels; channel++) {
    float *input = jack_port_get_buffer(inputs[channel], count);
    for (size_t frame = 0; frame < frames; frame++) block[frame * channels + channel] = input[frame];
  }
  size_t bytes = frames * channels * sizeof(float);
  if (jack_ringbuffer_write_space(records) < bytes) {
    atomic_store(&overflow, 1); atomic_store(&finished, 1); return 0;
  }
  jack_ringbuffer_write(records, (char *)block, bytes);
  record_at += frames;
  if (record_at >= total_frames) atomic_store(&finished, 1);
  return 0;
}
static jack_client_t *client(const char *name) {
  jack_status_t status;
  jack_client_t *result = jack_client_open(name, JackNoStartServer, &status);
  if (!result) { fprintf(stderr, "Cannot connect to private JACK server (%u).\n", status); exit(2); }
  if (jack_get_sample_rate(result) != 48000) { fprintf(stderr, "Lab requires 48000 Hz.\n"); exit(2); }
  jack_set_xrun_callback(result, xrun, NULL);
  return result;
}
int main(int argc, char **argv) {
  if (argc != 4) { fprintf(stderr, "Usage: graph source.f32 receivers tail-frames (receivers=calibrate for 20/80/150ms)\n"); return 2; }
  int calibration = strcmp(argv[2], "calibrate") == 0;
  int receivers = calibration ? 3 : atoi(argv[2]);
  if (receivers < 1 || receivers > 100) return 2;
  channels = (unsigned)receivers + 1;
  FILE *source = fopen(argv[1], "rb");
  if (!source || fseek(source, 0, SEEK_END)) return 2;
  long bytes = ftell(source);
  if (bytes <= 0 || bytes % 4 || bytes > 48000L * 4 * 120) return 2;
  rewind(source);
  signal_frames = (size_t)bytes / 4;
  signal_pcm = malloc((size_t)bytes);
  if (!signal_pcm || fread(signal_pcm, 4, signal_frames, source) != signal_frames) return 2;
  fclose(source);
  long tail = atol(argv[3]);
  if (tail < 0 || tail > 48000 * 10) return 2;
  total_frames = signal_frames + (size_t)tail;
  block = calloc(4096 * channels, sizeof(float));
  records = jack_ringbuffer_create(16 * 1024 * 1024);
  if (!block || !records) return 2;
  signal(SIGUSR1, start); signal(SIGTERM, stop); signal(SIGINT, stop);
  source_client = client("couch_lab_source");
  recorder_client = client("couch_lab_record");
  source_port = jack_port_register(source_client, "source", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  for (unsigned channel = 0; channel < channels; channel++) {
    char name[32]; snprintf(name, sizeof name, "input_%u", channel);
    inputs[channel] = jack_port_register(recorder_client, name, JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
    if (!inputs[channel]) return 2;
  }
  jack_set_process_callback(source_client, generate, NULL);
  jack_set_process_callback(recorder_client, record, NULL);
  if (jack_activate(source_client) || jack_activate(recorder_client)) return 2;
  if (jack_connect(source_client, jack_port_name(source_port), jack_port_name(inputs[0]))) return 2;
  if (calibration) {
    delay_line = calloc(8192, sizeof(float));
    delay_client = client("couch_lab_delay");
    delay_input = jack_port_register(delay_client, "input", JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
    for (unsigned i = 0; i < 3; i++) {
      char name[32]; snprintf(name, sizeof name, "delay_%u", delays[i]);
      delay_outputs[i] = jack_port_register(delay_client, name, JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
    }
    jack_set_process_callback(delay_client, delay, NULL);
    if (jack_activate(delay_client)) return 2;
    if (jack_connect(source_client, jack_port_name(source_port), jack_port_name(delay_input))) return 2;
    for (unsigned i = 0; i < 3; i++)
      if (jack_connect(source_client, jack_port_name(delay_outputs[i]), jack_port_name(inputs[i + 1]))) return 2;
  }
  fprintf(stderr, "READY channels=%u rate=48000 quantum=%u\n", channels, jack_get_buffer_size(source_client)); fflush(stderr);
  char output[65536];
  while (!stopped) {
    size_t count = jack_ringbuffer_read(records, output, sizeof output);
    if (count && fwrite(output, 1, count, stdout) != count) { stopped = 1; break; }
    if (atomic_load(&finished) && !jack_ringbuffer_read_space(records)) break;
    if (!count) usleep(1000);
  }
  jack_client_close(recorder_client); jack_client_close(source_client);
  if (delay_client) jack_client_close(delay_client);
  fprintf(stderr, "RESULT frames=%zu overflow=%d xruns=%d graphDeviationUs=%.3f\n", record_at, atomic_load(&overflow), atomic_load(&xruns), graph_deviation_us);
  fflush(stdout);
  jack_ringbuffer_free(records); free(block); free(signal_pcm); free(delay_line);
  return stopped || atomic_load(&overflow) || atomic_load(&xruns) ? 1 : 0;
}
