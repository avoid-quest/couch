// Private JACK source/recorder. CLABPCM1 protocol: audio-lab/presentation.md.
// SIGUSR2 arms preroll; SIGUSR1 starts the source at callback entry.
#include <jack/jack.h>
#include <jack/ringbuffer.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

_Static_assert(sizeof(float) == 4, "float32 PCM required");
_Static_assert(ATOMIC_INT_LOCK_FREE == 2, "Realtime flags require lock-free integers");
enum { OVERFLOW=1, DISCONTINUITY=2, RATE=4, QUANTUM=8, FREEWHEEL=16,
       SHUTDOWN=32, CYCLE_TIME=64, IO=128, BAD_COUNT=256, ABORTED=512 };
static jack_client_t *source_client, *recorder_client, *delay_client;
static jack_port_t *source_port, *inputs[101], *delay_input, *delay_outputs[3];
static jack_ringbuffer_t *records;
static float *signal_pcm, *delay_line, *receiver_fifo;
static unsigned char *packet;
static size_t signal_frames, source_at, total_frames, record_at, delay_at, fifo_at;
static unsigned channels, quantum, receiver_delay, sequence;
static uint32_t record_first, record_end;
static volatile sig_atomic_t arm_requested, start_requested, stop_requested;
static atomic_int armed, source_requested, source_started, finished, freewheeling;
static atomic_uint flags, xruns, topology, source_first;
static const unsigned delays[] = {960, 3840, 7200};
struct cycle { jack_client_t *client; uint32_t next; int seen; };
static struct cycle source_cycle, record_cycle, delay_cycle;

static void put32(unsigned char *p, uint32_t value) {
  for (unsigned i=0; i<4; i++) p[i]=(unsigned char)(value >> (8*i));
}
static void put64(unsigned char *p, uint64_t value) {
  for (unsigned i=0; i<8; i++) p[i]=(unsigned char)(value >> (8*i));
}
static void request(int signal) {
  if (signal == SIGUSR1) start_requested=1;
  else if (signal == SIGUSR2) arm_requested=1;
  else stop_requested=1;
}
static void flag(unsigned value) { if (atomic_load(&armed)) atomic_fetch_or(&flags, value); }
static int xrun(void *arg) { (void)arg; if (atomic_load(&armed)) atomic_fetch_add(&xruns, 1); return 0; }
static int graph_order(void *arg) { (void)arg; if (atomic_load(&armed)) atomic_fetch_add(&topology, 1); return 0; }
static void registration(jack_port_id_t id, int registered, void *arg) { (void)id; (void)registered; (void)graph_order(arg); }
static void connection(jack_port_id_t a, jack_port_id_t b, int connected, void *arg) { (void)a; (void)b; (void)connected; (void)graph_order(arg); }
static void rename_port(jack_port_id_t id, const char *old, const char *name, void *arg) { (void)id; (void)old; (void)name; (void)graph_order(arg); }
static int sample_rate(jack_nframes_t rate, void *arg) { (void)arg; if (rate != 48000) flag(RATE); return 0; }
static int buffer_size(jack_nframes_t count, void *arg) { (void)arg; if (count != quantum) flag(QUANTUM); return 0; }
static void freewheel(int starting, void *arg) { (void)arg; atomic_store(&freewheeling, starting); if (starting) flag(FREEWHEEL); }
static void shutdown_client(void *arg) { (void)arg; atomic_fetch_or(&flags, SHUTDOWN); atomic_store(&finished, 1); }
static uint32_t cycle_start(struct cycle *cycle, jack_nframes_t count) {
  uint32_t frame=jack_last_frame_time(cycle->client);
  if (cycle->seen && frame != cycle->next) flag(DISCONTINUITY);
  if (count != quantum) flag(QUANTUM);
  cycle->next=frame+count; cycle->seen=1;
  return frame;
}
static void record_header(unsigned char *out, const char *tag, uint32_t frame, unsigned count, jack_time_t current, jack_time_t next) {
  memset(out, 0, 64); memcpy(out, tag, 4);
  put32(out+4, sequence); put32(out+8, frame); put32(out+12, count);
  put32(out+16, atomic_load(&flags)); put32(out+20, atomic_load(&topology)); put32(out+24, atomic_load(&xruns));
  int started=atomic_load(&source_started);
  put32(out+28, (unsigned)started); put32(out+32, started ? atomic_load(&source_first) : 0);
  put64(out+40, current); put64(out+48, next); put64(out+56, record_at);
}
static int generate(jack_nframes_t count, void *arg) {
  (void)arg;
  uint32_t frame=cycle_start(&source_cycle, count);
  float *output=jack_port_get_buffer(source_port, count);
  // The request is latched once, never sampled inside the per-sample loop.
  int running=atomic_load(&source_started);
  if (!running && atomic_load(&armed) && atomic_load(&source_requested)) {
    atomic_store(&source_first, frame); atomic_store(&source_started, 1); running=1;
  }
  for (unsigned i=0; i<count; i++) output[i]=running && source_at<signal_frames ? signal_pcm[source_at++] : 0;
  return 0;
}
static int delay(jack_nframes_t count, void *arg) {
  (void)arg; (void)cycle_start(&delay_cycle, count);
  const float *input=jack_port_get_buffer(delay_input, count);
  float *outputs[3];
  for (unsigned c=0; c<3; c++) outputs[c]=jack_port_get_buffer(delay_outputs[c], count);
  for (unsigned i=0; i<count; i++, delay_at++) {
    delay_line[delay_at % 8192]=input[i];
    for (unsigned c=0; c<3; c++) outputs[c][i]=delay_at>=delays[c] ? delay_line[(delay_at-delays[c]) % 8192] : 0;
  }
  return 0;
}
static int record(jack_nframes_t count, void *arg) {
  (void)arg;
  if (!atomic_load(&armed) || atomic_load(&finished)) return 0;
  uint32_t frame=cycle_start(&record_cycle, count), cycle_frame=0;
  jack_time_t current=0, next=0; float period=0;
  if (jack_get_cycle_times(recorder_client, &cycle_frame, &current, &next, &period) || cycle_frame!=frame || !current || next<=current) flag(CYCLE_TIME);
  if (count>4096 || !count) { flag(BAD_COUNT); atomic_store(&armed, 0); atomic_store(&finished, 1); return 0; }
  size_t bytes=64+(size_t)count*channels*4;
  if (jack_ringbuffer_write_space(records)<bytes) { flag(OVERFLOW); atomic_store(&armed, 0); atomic_store(&finished, 1); return 0; }
  for (unsigned c=0; c<channels; c++) {
    const float *input=jack_port_get_buffer(inputs[c], count);
    for (unsigned i=0; i<count; i++) {
      float value=input[i];
      if (c && receiver_delay) {
        size_t at=(size_t)(c-1)*128+(fifo_at+i)%128;
        float previous=receiver_fifo[at]; receiver_fifo[at]=value; value=previous;
      }
      uint32_t bits; memcpy(&bits, &value, 4); put32(packet+64+((size_t)i*channels+c)*4, bits);
    }
  }
  fifo_at+=count;
  if (!sequence) record_first=frame;
  record_at+=count; record_end=frame+count;
  record_header(packet, "PCM1", frame, count, current, next);
  if (jack_ringbuffer_write(records, (const char *)packet, bytes)!=bytes) flag(OVERFLOW);
  sequence++;
  if (atomic_load(&source_started) && (uint32_t)(record_end-atomic_load(&source_first))>=total_frames) {
    atomic_store(&armed, 0); atomic_store(&finished, 1);
  } else if (record_at>total_frames+48000*10+4096) {
    flag(ABORTED); atomic_store(&armed, 0); atomic_store(&finished, 1);
  }
  return 0;
}
static jack_client_t *client(const char *name) {
  jack_status_t status;
  jack_client_t *value=jack_client_open(name, JackNoStartServer | JackUseExactName, &status);
  if (!value) { fprintf(stderr, "Cannot connect JACK client %s (%u)\n", name, status); exit(2); }
  unsigned q=jack_get_buffer_size(value);
  if (!quantum) quantum=q;
  if (jack_get_sample_rate(value)!=48000 || q!=quantum || q<128 || q>4096 || (q&(q-1))) exit(2);
  if (jack_set_xrun_callback(value, xrun, NULL) || jack_set_graph_order_callback(value, graph_order, NULL) ||
      jack_set_port_registration_callback(value, registration, NULL) || jack_set_port_connect_callback(value, connection, NULL) ||
      jack_set_port_rename_callback(value, rename_port, NULL) || jack_set_sample_rate_callback(value, sample_rate, NULL) ||
      jack_set_buffer_size_callback(value, buffer_size, NULL) || jack_set_freewheel_callback(value, freewheel, NULL)) exit(2);
  jack_on_shutdown(value, shutdown_client, NULL);
  return value;
}
static unsigned number(const char *text, unsigned maximum) {
  char *end; unsigned long value=strtoul(text, &end, 10);
  if (!*text || *end || *text=='-' || value>maximum) exit(2);
  return (unsigned)value;
}
int main(int argc, char **argv) {
  if (argc<4 || argc>5) { fprintf(stderr, "Usage: graph source.f32 receivers|calibrate tail-frames [0|128]\n"); return 2; }
  int calibration=!strcmp(argv[2], "calibrate");
  unsigned receivers=calibration ? 3 : number(argv[2], 100);
  if (!receivers) return 2;
  channels=receivers+1; receiver_delay=argc==5 ? number(argv[4], 128) : 0;
  if (receiver_delay && receiver_delay!=128) return 2;
  FILE *source=fopen(argv[1], "rb");
  if (!source || fseek(source, 0, SEEK_END)) return 2;
  long bytes=ftell(source);
  if (bytes<=0 || bytes%4 || bytes>48000L*4*120) return 2;
  rewind(source); signal_frames=(size_t)bytes/4;
  signal_pcm=malloc((size_t)bytes);
  if (!signal_pcm || fread(signal_pcm, 4, signal_frames, source)!=signal_frames) return 2;
  fclose(source);
  // The retained fixture is explicitly f32le, independently of native byte order.
  for (size_t i=0; i<signal_frames; i++) {
    const unsigned char *p=(const unsigned char *)&signal_pcm[i];
    uint32_t bits=(uint32_t)p[0] | (uint32_t)p[1]<<8 | (uint32_t)p[2]<<16 | (uint32_t)p[3]<<24;
    memcpy(&signal_pcm[i], &bits, 4);
  }
  total_frames=signal_frames+number(argv[3], 48000*10);
  packet=malloc(64+4096*channels*4); receiver_fifo=calloc((channels-1)*128, sizeof(float));
  records=jack_ringbuffer_create(16*1024*1024);
  if (!packet || !receiver_fifo || !records) return 2;
  signal(SIGUSR1, request); signal(SIGUSR2, request); signal(SIGTERM, request); signal(SIGINT, request); signal(SIGPIPE, SIG_IGN);
  source_client=client("couch_lab_source"); recorder_client=client("couch_lab_record");
  source_cycle.client=source_client; record_cycle.client=recorder_client;
  source_port=jack_port_register(source_client, "source", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  if (!source_port) return 2;
  for (unsigned c=0; c<channels; c++) {
    char name[32]; snprintf(name, sizeof name, "input_%u", c);
    inputs[c]=jack_port_register(recorder_client, name, JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
    if (!inputs[c]) return 2;
  }
  if (jack_set_process_callback(source_client, generate, NULL) || jack_set_process_callback(recorder_client, record, NULL) ||
      jack_activate(source_client) || jack_activate(recorder_client) ||
      jack_connect(source_client, jack_port_name(source_port), jack_port_name(inputs[0]))) return 2;
  if (calibration) {
    delay_line=calloc(8192, sizeof(float)); delay_client=client("couch_lab_delay"); delay_cycle.client=delay_client;
    if (!delay_line) return 2;
    delay_input=jack_port_register(delay_client, "input", JACK_DEFAULT_AUDIO_TYPE, JackPortIsInput, 0);
    if (!delay_input) return 2;
    for (unsigned i=0; i<3; i++) {
      char name[32]; snprintf(name, sizeof name, "delay_%u", delays[i]);
      delay_outputs[i]=jack_port_register(delay_client, name, JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
      if (!delay_outputs[i]) return 2;
    }
    if (jack_set_process_callback(delay_client, delay, NULL) || jack_activate(delay_client) ||
        jack_connect(source_client, jack_port_name(source_port), jack_port_name(delay_input))) return 2;
    for (unsigned i=0; i<3; i++) if (jack_connect(source_client, jack_port_name(delay_outputs[i]), jack_port_name(inputs[i+1]))) return 2;
  }
  unsigned char header[24]={0}; memcpy(header, "CLABPCM1", 8);
  put32(header+8, 48000); put32(header+12, channels); put32(header+16, quantum); put32(header+20, 1);
  if (fwrite(header, 1, sizeof header, stdout)!=sizeof header || fflush(stdout)) return 2;
  fprintf(stderr, "READY channels=%u rate=48000 quantum=%u protocol=CLABPCM1 receiverDelay=%u\n", channels, quantum, receiver_delay); fflush(stderr);
  int arm_sent=0, io_failed=0;
  jack_time_t began=jack_get_time();
  char output[65536];
  while (!atomic_load(&finished) && !stop_requested) {
    if (arm_requested && !arm_sent) {
      atomic_store(&armed, 1); arm_sent=1;
      if (jack_get_sample_rate(recorder_client)!=48000) flag(RATE);
      if (jack_get_buffer_size(recorder_client)!=quantum) flag(QUANTUM);
      if (atomic_load(&freewheeling)) flag(FREEWHEEL);
    }
    if (start_requested) atomic_store(&source_requested, 1);
    size_t count=jack_ringbuffer_read(records, output, sizeof output);
    if (count && (fwrite(output, 1, count, stdout)!=count || fflush(stdout))) { io_failed=1; break; }
    if (jack_get_time()-began>180000000) { atomic_fetch_or(&flags, ABORTED); break; }
    if (!count) usleep(1000);
  }
  int completed=atomic_load(&finished) && atomic_load(&source_started) && !atomic_load(&flags);
  atomic_store(&armed, 0);
  if (!atomic_load(&finished)) {
    atomic_fetch_or(&flags, ABORTED);
    jack_deactivate(recorder_client); // Early abort only: normal completion retains topology.
  }
  if (io_failed) atomic_fetch_or(&flags, IO);
  for (;;) {
    size_t count=jack_ringbuffer_read(records, output, sizeof output);
    if (!count) break;
    if (fwrite(output, 1, count, stdout)!=count) { atomic_fetch_or(&flags, IO); break; }
  }
  record_header(packet, "END1", record_end, 0, 0, 0);
  if (fwrite(packet, 1, 64, stdout)!=64 || fflush(stdout)) atomic_fetch_or(&flags, IO);
  fprintf(stderr, "RESULT frames=%zu overflow=%u xruns=%u flags=%u topologyChanges=%u sourceStarted=%d sourceFirstFrame=%u recordFirstFrame=%u recordEndFrame=%u\n",
    record_at, !!(atomic_load(&flags)&OVERFLOW), atomic_load(&xruns), atomic_load(&flags), atomic_load(&topology),
    atomic_load(&source_started), atomic_load(&source_first), record_first, record_end);
  fprintf(stderr, "CAPTURE_DONE\n"); fflush(stderr);
  // Parent first stops/closes witness, then sends SIGTERM here. No port teardown
  // is allowed to invalidate a still-armed witness's final callbacks.
  while (!stop_requested && !(atomic_load(&flags)&SHUTDOWN)) {
    if (jack_get_time()-began>240000000) { atomic_fetch_or(&flags, ABORTED); break; }
    usleep(1000);
  }
  jack_client_close(recorder_client); jack_client_close(source_client);
  if (delay_client) jack_client_close(delay_client);
  jack_ringbuffer_free(records); free(packet); free(signal_pcm); free(delay_line); free(receiver_fifo);
  return !completed || atomic_load(&flags) || atomic_load(&xruns) || atomic_load(&topology) ? 1 : 0;
}
